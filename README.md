# Turso Duplicate Columns Repro

Small TypeScript repro for a row-shape difference between `@libsql/client` and
`@tursodatabase/database@0.7.0-pre.4`.

It runs the same duplicate-column query against both clients:

```sql
select role.path, org_unit.path from role join org_unit
```

The expected positional row values are:

```text
row[0] = /Employee
row[1] = /
```

`@libsql/client` exposes those values. Turso's `db.all()` does not; the duplicate
`path` property collapses and `row[0]` / `row[1]` are missing. Turso's
`raw(true).all()` still returns both values, so the data is available but not on
the default object row.

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
  row.path: "/Employee"
  row[0]: "/Employee"
  row[1]: "/"

@tursodatabase/database db.all()
  Object.keys(row): ["path"]
  row.path: "/"
  row[0]: undefined
  row[1]: undefined
  raw(true).all(): [["/Employee","/"]]
Observed difference: libsql keeps positional row values; Turso db.all() does not.
```
