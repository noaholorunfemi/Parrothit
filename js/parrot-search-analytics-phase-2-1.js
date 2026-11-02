/* PARROT SEARCH 2.1 analytics logger update.
   Merge this small change into js/parrot-search.js if you maintain that file separately.
   The replacement dashboard migration accepts the selected category as the third RPC argument. */
async function parrothitLogSearchAnalytics(client, query, resultCount, categoryName) {
  if (!client || !query) return;
  try {
    await client.rpc('parrothit_log_search', {
      search_term: query,
      result_count: resultCount,
      category_name: categoryName || null
    });
  } catch (error) {
    console.warn('PARROT SEARCH analytics could not be recorded:', error);
  }
}
