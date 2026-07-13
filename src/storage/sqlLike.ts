/** Escapes SQLite `LIKE` wildcards (`%`, `_`) and the escape character itself in a
 * user-supplied search term, so e.g. searching for a literal "50%" or "a_b" doesn't
 * behave like a wildcard. Pair with `LIKE ? ESCAPE '\'` and wrap the result in `%...%`
 * at the call site. */
export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (char) => `\\${char}`);
}
