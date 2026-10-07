function cbrGetReviewProvider(store) {
  if (store == null || String(store).trim() === '') {
    throw new Error('Missing store for review provider.');
  }
  if (store === CBR_CONFIG.STORE.CAFEBAZAAR) return CBR_CAFEBAZAAR_PROVIDER;
  throw new Error('Unsupported store: ' + String(store));
}

if (typeof module !== 'undefined') module.exports = { getReviewProvider: cbrGetReviewProvider };
