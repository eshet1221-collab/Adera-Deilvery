// Turns free-text user input into a safe FTS5 MATCH query. FTS5's query
// syntax has its own reserved characters/keywords (AND, OR, NOT, quotes,
// colons, parens...) — quoting each token neutralizes all of that. Each
// term is ANDed together (space-separated), so "eshe 091" only matches rows
// containing both. The tables this queries use tokenize='trigram' (see
// db.js), which matches substrings anywhere in the text, not just from the
// start of a word — so this also works for "search the middle of a phone
// number" style queries. Trigrams need 3+ characters to match anything; a
// 1-2 character search returns zero rows rather than erroring.
function toFtsQuery(term) {
  const tokens = String(term ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8); // cap — a search box isn't the place for a 500-word query
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

function parsePagination(query, { defaultPageSize = 25, maxPageSize = 100 } = {}) {
  let page = Number.parseInt(query.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let pageSize = Number.parseInt(query.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultPageSize;
  pageSize = Math.min(pageSize, maxPageSize);

  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

module.exports = { toFtsQuery, parsePagination };
