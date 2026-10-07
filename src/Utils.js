function cbrNormalizeDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('Invalid date: Invalid Date');
    return cbrFormatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  var text = String(value == null ? '' : value).trim();
  var match = /^(\d{4})[\/-](\d{2})[\/-](\d{2})$/.exec(text);
  if (!match) throw new Error('Invalid date: ' + text);
  return cbrFormatDateParts(Number(match[1]), Number(match[2]), Number(match[3]), text);
}

function cbrFormatDateParts(year, month, day, originalValue) {
  var leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  var daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new Error('Invalid date: ' + String(originalValue == null ? year + '-' + month + '-' + day : originalValue));
  }
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function cbrNowIso() {
  return new Date().toISOString();
}

function cbrString(value) {
  return value == null ? '' : String(value);
}

function cbrCafeBazaarSourceUrl(packageName) {
  return CBR_CONFIG.CAFEBAZAAR_APP_URL_PREFIX + packageName;
}

function cbrStoreDisplayName(store) {
  var labels = { cafebazaar: 'CafeBazaar', myket: 'Myket', sibapp: 'SibApp' };
  return Object.prototype.hasOwnProperty.call(labels, store) ? labels[store] : store;
}

function cbrReviewId(value) {
  if (value == null || String(value).trim() === '') throw new Error('Review is missing id.');
  return String(value);
}

function cbrSafeJson(value) {
  var json = JSON.stringify(value);
  if (json.length <= CBR_CONFIG.MAX_CELL_CHARS) return json;
  return json.slice(0, CBR_CONFIG.MAX_CELL_CHARS - 32) + '...[truncated]';
}

function cbrReplyValue(reply) {
  if (reply == null) return '';
  if (typeof reply === 'object') return cbrSafeJson(reply);
  var text = String(reply);
  return text.length <= CBR_CONFIG.MAX_CELL_CHARS ? text : text.slice(0, CBR_CONFIG.MAX_CELL_CHARS - 32) + '...[truncated]';
}

function cbrReviewToRow(review, fetchedAt) {
  return [
    cbrReviewId(review.id), cbrNormalizeDate(review.date), cbrString(review.user),
    review.rate == null ? '' : review.rate, cbrString(review.comment),
    review.versionCode == null ? '' : review.versionCode,
    review.likes == null ? '' : review.likes, review.total == null ? '' : review.total,
    cbrReplyValue(review.reply), review.isEdited === true,
    cbrString(review.accountID), cbrString(review.avatarURL),
    review.userRepliesCount == null ? '' : review.userRepliesCount,
    fetchedAt, cbrSafeJson(Object.prototype.hasOwnProperty.call(review, 'rawReview') ? review.rawReview : review)
  ];
}

function cbrHistoryPageDecision(reviews, targetDate, nextCursor) {
  var target = cbrNormalizeDate(targetDate);
  var accepted = [];
  var crossed = false;
  for (var i = 0; i < reviews.length; i++) {
    var date = cbrNormalizeDate(reviews[i].date);
    if (date >= target) accepted.push(reviews[i]);
    else crossed = true;
  }
  return {
    accepted: accepted,
    stop: reviews.length === 0 || crossed || !nextCursor,
    crossed: crossed,
    nextCursor: cbrString(nextCursor)
  };
}

function cbrSyncPageDecision(reviews, knownIdsBeforePage, nextCursor, importFromDate) {
  var newReviews = [];
  var knownReviews = [];
  var eligible = [];
  var olderCount = 0;
  var boundary = cbrNormalizeDate(importFromDate);
  for (var i = 0; i < reviews.length; i++) {
    if (cbrNormalizeDate(reviews[i].date) < boundary) {
      olderCount++;
      continue;
    }
    eligible.push(reviews[i]);
    var id = cbrReviewId(reviews[i].id);
    if (knownIdsBeforePage.has(id)) knownReviews.push(reviews[i]);
    else newReviews.push(reviews[i]);
  }
  return {
    eligible: eligible,
    olderCount: olderCount,
    newReviews: newReviews,
    knownReviews: knownReviews,
    stop: reviews.length === 0 || olderCount > 0 || newReviews.length === 0 || !nextCursor,
    nextCursor: cbrString(nextCursor)
  };
}

function cbrPublicError(error) {
  return error && error.message ? error.message : String(error);
}

if (typeof module !== 'undefined') module.exports = {
  normalizeDate: cbrNormalizeDate,
  cafeBazaarSourceUrl: cbrCafeBazaarSourceUrl,
  reviewId: cbrReviewId,
  reviewToRow: cbrReviewToRow,
  historyPageDecision: cbrHistoryPageDecision,
  syncPageDecision: cbrSyncPageDecision
};
