# Repository convention: `Row` / `TableRow` / `toRow`

Each repository in this directory (`profile-repository.ts`, `session-repository.ts`,
`login-token-repository.ts`) follows the same shape at the database boundary:

- A public `*Row` interface (e.g. `ProfileRow`) using camelCase fields — the shape the rest of the
  server code works with.
- A private `*TableRow` interface matching the raw `better-sqlite3` result shape, with snake_case
  fields mirroring the SQL column names exactly.
- A private `toRow(row: *TableRow): *Row` function that maps one to the other.

Query methods cast `better-sqlite3`'s `unknown` statement results to the `*TableRow` type, then
call `toRow` before returning to callers. This keeps the snake_case/camelCase boundary — and the
raw driver's untyped results — contained to a single conversion function per repository, so
callers never see snake_case field names or work with unvalidated row shapes.
