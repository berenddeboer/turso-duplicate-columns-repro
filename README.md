# Turso Duplicate Columns Repro

Small TypeScript reproducer for a row-shape difference between `@libsql/client`
and `@tursodatabase/database`.

The query selects two columns with the same result name:

```sql
select role.path, org_unit.path
from role
join org_unit
```

`@libsql/client` exposes the values positionally as `row[0]` and `row[1]`,
which is what sqlite-proxy consumers such as Drizzle rely on when selected
column names are not unique.

`@tursodatabase/database@0.7.0-pre.4` returns only an object row from
`db.all()`. The duplicate `path` property collapses, and `row[0]` / `row[1]`
are missing. `statement.raw(true).all()` still returns both values as an array.

## Run

```sh
bun install
bun run repro
```

The script exits successfully when it observes the difference.

