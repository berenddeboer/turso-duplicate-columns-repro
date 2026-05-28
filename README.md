# Turso Duplicate Columns Repro

This is a small TypeScript reproducer for a row-shape difference between
`@libsql/client` and `@tursodatabase/database@0.7.0-pre.4`.

It demonstrates that `@libsql/client` preserves positional values on result rows
when a query selects duplicate column names, while `@tursodatabase/database`
loses those positional values when using `db.all()`.

This matters for consumers such as Drizzle's sqlite-proxy driver, which reads
selected fields positionally. SQL queries can legitimately return multiple
columns with the same result name, for example when joining tables that both have
a `path` column.

## What It Does

The script creates two small databases:

- one using `@libsql/client`
- one using `@tursodatabase/database`

Each database has two tables:

```sql
create table role (id text primary key, path text not null);
create table org_unit (id text primary key, path text not null);
```

It inserts these rows:

```text
role.path = /Employee
org_unit.path = /
```

The query selects two columns with the same result name:

```sql
select role.path, org_unit.path
from role
join org_unit
```

## Expected Behavior

The result row should expose both selected values positionally:

```text
row[0] = /Employee
row[1] = /
```

`@libsql/client` does this.

## Observed Turso Behavior

`@tursodatabase/database@0.7.0-pre.4` returns only an object row from `db.all()`.
The duplicate `path` property collapses, and `row[0]` / `row[1]` are missing.

`statement.raw(true).all()` still returns both values as an array, so the values
are available in Turso, but they are not exposed on the default `db.all()` row
shape.

## Run

```sh
bun install
bun run repro
```

The script exits successfully when it observes the difference.

## Output

You should see output like this:

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

The important difference is:

- `@libsql/client`: `row[0]` and `row[1]` are present.
- `@tursodatabase/database db.all()`: `row[0]` and `row[1]` are `undefined`.
- `@tursodatabase/database raw(true).all()`: both values are still present.
