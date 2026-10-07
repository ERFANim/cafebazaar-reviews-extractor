function cbrRunHistory(app, initialCursor, provider) {
  var sheet = cbrResolveAppSheet(app);
  var reviewState = cbrLoadReviewState(sheet);
  var cursor = cbrString(initialCursor);
  var startedAt = Date.now();
  var counts = { newReviews: 0, updatedReviews: 0, processedReviews: 0, pagesFetched: 0 };
  var oldestImported = app.imported_until_date || '';
  while (true) {
    var currentPageCursor = cursor;
    var page = provider.fetchReviewPage(app, cursor);
    counts.pagesFetched++;
    var decision = cbrHistoryPageDecision(page.reviews, app.import_from_date, page.nextCursor);
    var writeCounts = cbrUpsertReviews(sheet, decision.accepted, reviewState, cbrNowIso());
    counts.newReviews += writeCounts.newCount;
    counts.updatedReviews += writeCounts.updatedCount;
    counts.processedReviews += page.reviews.length;
    for (var i = 0; i < decision.accepted.length; i++) {
      var date = cbrNormalizeDate(decision.accepted[i].date);
      if (!oldestImported || date < oldestImported) oldestImported = date;
    }
    var coverage = cbrCoverageFromState(reviewState);
    cbrUpdateApp(app.package_name, {
      operation_cursor: decision.nextCursor,
      imported_until_date: oldestImported,
      coverage_from_date: coverage.oldest,
      coverage_to_date: coverage.newest,
      status: CBR_CONFIG.STATUS.RUNNING,
      last_error: ''
    });
    if (decision.stop) {
      cbrSortReviews(sheet);
      cbrUpdateApp(app.package_name, {
        operation_type: '', operation_cursor: '', status: CBR_CONFIG.STATUS.READY,
        imported_until_date: oldestImported, history_anchor_cursor: currentPageCursor,
        last_error: ''
      });
      counts.paused = false;
      counts.message = 'Historical import completed.';
      return counts;
    }
    if (Date.now() - startedAt >= CBR_CONFIG.SOFT_DEADLINE_MS) {
      cbrSortReviews(sheet);
      cbrUpdateApp(app.package_name, {
        operation_type: CBR_CONFIG.OPERATION.HISTORY,
        operation_cursor: decision.nextCursor,
        status: CBR_CONFIG.STATUS.PAUSED,
        last_error: ''
      });
      counts.paused = true;
      counts.message = 'Historical import paused safely. Press Continue Import to resume.';
      return counts;
    }
    cursor = decision.nextCursor;
  }
}
