function cbrNormalizeCafeBazaarReview(rawReview) {
  if (!rawReview || typeof rawReview !== 'object') {
    throw new Error('CafeBazaar response contains an invalid review.');
  }
  return {
    id: rawReview.id,
    date: cbrNormalizeDate(rawReview.date),
    user: rawReview.user,
    rate: rawReview.rate,
    comment: rawReview.comment,
    versionCode: rawReview.versionCode,
    likes: rawReview.likes,
    total: rawReview.total,
    reply: rawReview.reply,
    isEdited: rawReview.isEdited,
    accountID: rawReview.accountID,
    avatarURL: rawReview.avatarURL,
    userRepliesCount: rawReview.userRepliesCount,
    rawReview: rawReview
  };
}

function cbrCafeBazaarFetchReviewPage(app, cursor) {
  var page = cbrFetchReviewPage(app.package_name, cursor);
  return {
    reviews: page.reviews.map(cbrNormalizeCafeBazaarReview),
    nextCursor: page.nextPageCursor
  };
}

var CBR_CAFEBAZAAR_PROVIDER = Object.freeze({ fetchReviewPage: cbrCafeBazaarFetchReviewPage });

if (typeof module !== 'undefined') module.exports = {
  normalizeReview: cbrNormalizeCafeBazaarReview,
  fetchReviewPage: cbrCafeBazaarFetchReviewPage
};
