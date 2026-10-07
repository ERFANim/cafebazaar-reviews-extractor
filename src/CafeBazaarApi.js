var CBR_CAFEBAZAAR_API_CONFIG = Object.freeze({
  URL: 'https://api.cafebazaar.ir/rest-v1/process/ReviewRequest',
  SORT_BY: 1,
  FETCH_RETRIES: 2,
  RETRY_BASE_MS: 500
});

function cbrBuildRequestBody(packageName, cursor) {
  if (cursor != null && typeof cursor !== 'string') {
    throw new Error('CafeBazaar cursor must be a string.');
  }
  return {
    singleRequest: {
      reviewRequest: {
        packageName: String(packageName),
        cursor: cursor == null ? '' : cursor,
        sortBy: CBR_CAFEBAZAAR_API_CONFIG.SORT_BY
      }
    }
  };
}

function cbrParseApiResponse(httpCode, text) {
  var payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error('CafeBazaar returned malformed JSON (HTTP ' + httpCode + ').');
  }
  if (httpCode < 200 || httpCode >= 300) {
    var httpMessage = payload && payload.properties && payload.properties.errorMessage;
    throw new Error('CafeBazaar HTTP ' + httpCode + (httpMessage ? ': ' + httpMessage : '.'));
  }
  var logicalCode = payload && payload.properties && Number(payload.properties.statusCode);
  if (logicalCode !== 200) {
    var logicalMessage = payload && payload.properties && payload.properties.errorMessage;
    throw new Error('CafeBazaar status ' + (isNaN(logicalCode) ? 'missing' : logicalCode) +
      (logicalMessage ? ': ' + logicalMessage : '.'));
  }
  var reply = payload && payload.singleReply && payload.singleReply.reviewReply;
  if (!reply) throw new Error('CafeBazaar response is missing reviewReply.');
  if (!Array.isArray(reply.reviews)) throw new Error('CafeBazaar response is missing reviews array.');
  if (reply.nextPageCursor != null && typeof reply.nextPageCursor !== 'string') {
    throw new Error('CafeBazaar response has an invalid nextPageCursor.');
  }
  return { reviews: reply.reviews, nextPageCursor: reply.nextPageCursor == null ? '' : reply.nextPageCursor };
}

function cbrFetchReviewPage(packageName, cursor) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(cbrBuildRequestBody(packageName, cursor)),
    muteHttpExceptions: true
  };
  for (var attempt = 0; attempt <= CBR_CAFEBAZAAR_API_CONFIG.FETCH_RETRIES; attempt++) {
    var response;
    try {
      response = UrlFetchApp.fetch(CBR_CAFEBAZAAR_API_CONFIG.URL, options);
    } catch (error) {
      throw new Error('CafeBazaar request failed: ' + cbrPublicError(error));
    }
    var code = response.getResponseCode();
    if ((code === 429 || code >= 500) && attempt < CBR_CAFEBAZAAR_API_CONFIG.FETCH_RETRIES) {
      Utilities.sleep(CBR_CAFEBAZAAR_API_CONFIG.RETRY_BASE_MS * Math.pow(2, attempt));
      continue;
    }
    return cbrParseApiResponse(code, response.getContentText());
  }
  throw new Error('CafeBazaar request failed after retries.');
}

if (typeof module !== 'undefined') module.exports = {
  buildRequestBody: cbrBuildRequestBody,
  parseApiResponse: cbrParseApiResponse
};
