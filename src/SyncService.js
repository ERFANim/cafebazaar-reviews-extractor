function cbrRunSync(app, initialCursor, provider) {
  var sheet = cbrResolveAppSheet(app);
  var reviewState = cbrLoadReviewState(sheet);
  var cursor = cbrString(initialCursor);
  var startedAt = Date.now();
  var counts = { newReviews: 0, updatedReviews: 0, processedReviews: 0, pagesFetched: 0 };
  while (true) {
    var page = provider.fetchReviewPage(app, cursor);
    counts.pagesFetched++;
    var knownBeforePage = new Set(reviewState.index.keys());
    var decision = cbrSyncPageDecision(page.reviews, knownBeforePage, page.nextCursor, app.import_from_date);
    var writeCounts = cbrUpsertReviews(sheet, decision.eligible, reviewState, cbrNowIso());
    counts.newReviews += writeCounts.newCount;
    counts.updatedReviews += writeCounts.updatedCount;
    counts.processedReviews += writeCounts.processedCount;
    var coverage = cbrCoverageFromState(reviewState);
    cbrUpdateApp(app.package_name, {
      operation_cursor: decision.nextCursor,
      coverage_from_date: coverage.oldest,
      coverage_to_date: coverage.newest,
      status: CBR_CONFIG.STATUS.RUNNING,
      last_error: ''
    });
    if (decision.stop) {
      cbrSortReviews(sheet);
      cbrUpdateApp(app.package_name, {
        operation_type: '', operation_cursor: '', status: CBR_CONFIG.STATUS.READY,
        last_sync_at: cbrNowIso(), last_error: ''
      });
      counts.paused = false;
      counts.message = 'Sync completed.';
      return counts;
    }
    if (Date.now() - startedAt >= CBR_CONFIG.SOFT_DEADLINE_MS) {
      cbrSortReviews(sheet);
      cbrUpdateApp(app.package_name, {
        operation_type: CBR_CONFIG.OPERATION.SYNC,
        operation_cursor: decision.nextCursor,
        status: CBR_CONFIG.STATUS.PAUSED,
        last_error: ''
      });
      counts.paused = true;
      counts.message = 'Sync paused safely. Press Continue Sync to resume.';
      return counts;
    }
    cursor = decision.nextCursor;
  }
}
