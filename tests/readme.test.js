'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(withReadme = false) {
  const apps = { name: 'Apps', id: 1, hidden: true, rows: [['package_name'], ['com.example.app']] };
  const reviews = { name: 'Example - CafeBazaar', id: 42, hidden: false, rows: [['review_id'], ['123']] };
  const sheets = [apps, reviews];
  if (withReadme) sheets.push({ name: 'README', id: 77, hidden: false, rows: [['User-owned content']] });
  const inserted = [];
  let panelOpens = 0;
  let lockCalls = 0;
  const spreadsheet = {
    getSheetByName(name) { return sheets.find(sheet => sheet.name === name) || null; },
    getSheets() { return sheets; },
    insertSheet(name, index) {
      const sheet = {
        name, id: 100 + inserted.length, hidden: false, rows: [], writes: 0, formats: 0, link: null,
        getRange(row, column, height = 1) {
          const range = {
            setValues(values) {
              sheet.writes++;
              for (let i = 0; i < height; i++) sheet.rows[row + i - 1] = [values[i][0]];
              return range;
            },
            setWrap() { sheet.formats++; return range; },
            setFontFamily() { sheet.formats++; return range; },
            setFontSize() { sheet.formats++; return range; },
            setFontWeight() { sheet.formats++; return range; },
            setRichTextValue(value) {
              sheet.writes++;
              sheet.rows[row - 1] = [value.text];
              sheet.link = value.url;
              return range;
            }
          };
          return range;
        },
        setColumnWidth() { this.formats++; }
      };
      inserted.push({ name, index, sheet });
      sheets.splice(index, 0, sheet);
      return sheet;
    }
  };
  const ui = {
    createMenu() { return { addItem() { return this; }, addToUi() {} }; },
    showSidebar() { panelOpens++; }
  };
  const context = vm.createContext({
    SpreadsheetApp: {
      getActive: () => spreadsheet,
      getUi: () => ui,
      newRichTextValue: () => ({
        setText(text) { this.text = text; return this; },
        setLinkUrl(url) { this.url = url; return this; },
        build() { return { text: this.text, url: this.url }; }
      })
    },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; } }) },
    cbrWithDocumentLock(action) { lockCalls++; return action(); }
  });
  for (const file of ['ReadmeSheet.js', 'Code.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context, { filename: file });
  }
  return { context, spreadsheet, sheets, apps, reviews, inserted,
    get panelOpens() { return panelOpens; }, get lockCalls() { return lockCalls; } };
}

test('opening the panel creates a short linked README first without changing existing sheets', () => {
  const env = setup();
  const appsBefore = JSON.stringify(env.apps);
  const reviewsBefore = JSON.stringify(env.reviews);
  env.context.showSidebar();

  assert.equal(env.inserted.length, 1);
  assert.deepEqual([env.inserted[0].name, env.inserted[0].index], ['README', 0]);
  assert.deepEqual(env.sheets.map(sheet => sheet.name), ['README', 'Apps', 'Example - CafeBazaar']);
  assert.equal(env.sheets[0].rows[0][0], 'CafeBazaar Reviews Extractor');
  assert.match(env.sheets[0].rows.map(row => row[0]).join('\n'), /CafeBazaar Reviews → Open Panel/);
  assert.match(env.sheets[0].rows.map(row => row[0]).join('\n'), /Add & Import/);
  assert.equal(env.sheets[0].link, 'https://github.com/ERFANim/cafebazaar-reviews-extractor');
  assert.equal(JSON.stringify(env.apps), appsBefore);
  assert.equal(JSON.stringify(env.reviews), reviewsBefore);
  assert.equal(env.apps.hidden, true);
  assert.equal(env.panelOpens, 1);
  assert.equal(env.lockCalls, 1);
});

test('an existing README is neither duplicated nor rewritten', () => {
  const env = setup(true);
  const existing = env.spreadsheet.getSheetByName('README');
  const before = JSON.stringify(env.sheets);
  env.context.showSidebar();
  env.context.showSidebar();
  assert.equal(env.inserted.length, 0);
  assert.equal(env.spreadsheet.getSheetByName('README'), existing);
  assert.equal(JSON.stringify(env.sheets), before);
  assert.equal(env.panelOpens, 2);
  assert.equal(env.lockCalls, 0);
});

test('the simple onOpen menu trigger does not create or rewrite README', () => {
  const env = setup();
  env.context.onOpen();
  assert.equal(env.inserted.length, 0);
  assert.equal(env.spreadsheet.getSheetByName('README'), null);
});
