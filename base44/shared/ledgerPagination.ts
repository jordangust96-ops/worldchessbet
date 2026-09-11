// Read every page before calculating balances or mutating the queried set.
// A failed page aborts the operation; partial histories must never become balances.
export async function allLedgerRows(entity, query, sort = 'created_date', pageSize = 500) {
  const rows = [];
  for (let skip = 0; ; ) {
    const page = await entity.filter(query, sort, pageSize, skip);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    skip += page.length;
  }
}
