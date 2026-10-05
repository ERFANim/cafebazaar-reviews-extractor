function cbrBuildRequestBody(packageName, cursor) {
  return {
    singleRequest: {
      reviewRequest: {
        packageName: String(packageName),
        cursor: cursor == null ? '' : String(cursor),
        sortBy: CBR_CONFIG.SORT_BY
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
  return { reviews: reply.reviews, nextPageCursor: cbrString(reply.nextPageCursor) };
}

function cbrFetchReviewPage(packageName, cursor) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(cbrBuildRequestBody(packageName, cursor)),
    muteHttpExceptions: true
  };
  for (var attempt = 0; attempt <= CBR_CONFIG.FETCH_RETRIES; attempt++) {
    var response;
    try {
      response = UrlFetchApp.fetch(CBR_CONFIG.API_URL, options);
    } catch (error) {
      throw new Error('CafeBazaar request failed: ' + cbrPublicError(error));
    }
    var code = response.getResponseCode();
    if ((code === 429 || code >= 500) && attempt < CBR_CONFIG.FETCH_RETRIES) {
      Utilities.sleep(CBR_CONFIG.RETRY_BASE_MS * Math.pow(2, attempt));
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
