# Turso Duplicate Columns Repro

Small TypeScript repro for a row-shape difference between `@libsql/client` and
`@tursodatabase/database@0.7.0-pre.6`.

It runs the same duplicate-column query against both clients:

```sql
select role.path, org_unit.path from role join org_unit
```

The expected positional row values are:

```text
row[0] = /Employee
row[1] = /
```

## Status after tursodatabase/turso#7285

The original report ([#7278](https://github.com/tursodatabase/turso/issues/7278))
was that Turso's `db.all()` rows dropped positional values entirely
(`row[0]` / `row[1]` were `undefined`). PR
[#7285](https://github.com/tursodatabase/turso/pull/7285) (in `0.7.0-pre.6`)
adds those numeric properties back, so `row[0]` / `row[1]` are now populated.

However, this **does not fix the actual problem** for `sqlite-proxy` /
Drizzle consumers. The Turso row object is still:

- **not array-like** — it has no `length` property, so `Array.from(row)` returns
  `[]`;
- **not iterable** — `[...row]` throws;
- and `Object.keys(row)` / `Object.values(row)` still collapse the duplicate
  `path` column, returning a single (wrong) value.

`@libsql/client` rows are array-like (they expose `length`), which is exactly
why `Array.from(row)` / sqlite-proxy work against libsql but break against
Turso. On Turso, `raw(true).all()` is currently the only reliable way to read a
row positionally.

## Run

```sh
bun install
bun run repro
```

Expected output:

```text
$ bun run src/index.ts

@libsql/client
  Object.keys(row): ["path"]
  Object.values(row): ["/Employee"]
  Object.getOwnPropertyNames(row): ["0","1","length","path"]
  row.length: 2
  Array.from(row): ["/Employee","/"]
  iterable: false
  row.path: "/Employee"
  row[0]: "/Employee"
  row[1]: "/"

@tursodatabase/database db.all()
  Object.keys(row): ["path"]
  Object.values(row): ["/"]
  Object.getOwnPropertyNames(row): ["0","1","path"]
  row.length: undefined
  Array.from(row): []
  iterable: false
  row.path: "/"
  row[0]: "/Employee"
  row[1]: "/"
  raw(true).all(): [["/Employee","/"]]

Still reproduces on 0.7.0-pre.6 (with #7285 applied):
  - Turso db.all() rows now carry numeric props (row[0], row[1]) ✔
  - but the row is NOT array-like (no `length`) and NOT iterable ✘
  - and Object.keys()/Object.values() still collapse duplicate column names ✘
  - so Array.from(row) -> [], [...row] throws, Object.values(row) -> short array.
  - @libsql/client rows ARE array-like, so sqlite-proxy/Drizzle work there but not on Turso.
  - raw(true).all() is currently the only reliable positional accessor on Turso.
```
