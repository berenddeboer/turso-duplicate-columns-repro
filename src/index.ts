import * as Libsql from "@libsql/client"
import { connect } from "@tursodatabase/database"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

type RowLike = Record<string, unknown> & {
  readonly [index: number]: unknown
  readonly length?: number
}

// Mirrors how an array-like consumer (e.g. Drizzle's sqlite-proxy) reads a row
// positionally. Returns [] when the row is not array-like (no `length`).
function arrayFromRow(row: RowLike | undefined): unknown[] {
  if (row === undefined) return []
  return Array.from(row as ArrayLike<unknown>)
}

type ReproResult = {
  readonly label: string
  readonly objectRow: RowLike | undefined
  readonly rawRows?: readonly unknown[]
}

const workDir = join(tmpdir(), `turso-duplicate-columns-repro-${process.pid}`)

async function main() {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })

  try {
    const libsql = await runLibsql()
    const turso = await runTurso()

    printResult(libsql)
    printResult(turso)

    // libsql returns array-like rows (they have `length` and numeric indices),
    // so Array.from(row) recovers every selected column positionally even when
    // the column names are duplicated.
    const libsqlRow = libsql.objectRow
    const libsqlArrayLikePreserved =
      JSON.stringify(arrayFromRow(libsqlRow)) ===
      JSON.stringify(["/Employee", "/"])

    // After tursodatabase/turso#7285, Turso db.all() rows DO carry the
    // positional values via numeric index access (row[0]/row[1]).
    const tursoRow = turso.objectRow
    const tursoIndexedPreserved =
      tursoRow?.[0] === "/Employee" && tursoRow?.[1] === "/"

    // ...but the row is still NOT array-like: it has no `length` property and
    // is not iterable, and the duplicate column name collapses the enumerable
    // string keys. So the standard ways to read a row positionally are all
    // still broken:
    //   Object.keys(row)   -> ["path"]   (1 key, not 2)
    //   Object.values(row) -> ["/"]      (1 value, the last duplicate)
    //   Array.from(row)    -> []         (no `length`, so not array-like)
    //   [...row]           -> TypeError  (not iterable)
    // sqlite-proxy consumers such as Drizzle read selected fields positionally
    // (via Array.from(row) / Object.values(row)), so they still receive a
    // short, misaligned array and silently corrupt results. @libsql/client
    // works there precisely because its rows ARE array-like.
    const tursoLength = (tursoRow as { length?: unknown } | undefined)?.length
    const tursoNotArrayLike = tursoLength === undefined
    const tursoArrayFromBroken =
      JSON.stringify(arrayFromRow(tursoRow)) ===
      JSON.stringify([])
    const tursoNotIterable =
      typeof (tursoRow as { [Symbol.iterator]?: unknown } | undefined)?.[
        Symbol.iterator
      ] !== "function"

    const tursoRawPreservesPositions =
      JSON.stringify(turso.rawRows) === JSON.stringify([["/Employee", "/"]])

    if (!libsqlArrayLikePreserved) {
      throw new Error(
        "libsql rows are no longer array-like; this repro's baseline assumption changed",
      )
    }

    if (!tursoIndexedPreserved) {
      throw new Error(
        "Turso db.all() did not expose positional values via numeric index; #7285 may have regressed",
      )
    }

    if (!tursoNotArrayLike || !tursoArrayFromBroken) {
      throw new Error(
        "Turso db.all() rows are now array-like (have `length`); this repro may no longer reproduce",
      )
    }

    if (!tursoNotIterable) {
      throw new Error(
        "Turso db.all() row is now iterable; this repro may no longer reproduce",
      )
    }

    if (!tursoRawPreservesPositions) {
      throw new Error("Turso raw(true) did not return both positional values")
    }

    console.log(
      "\nStill reproduces on 0.7.0-pre.6 (with #7285 applied):\n" +
        "  - Turso db.all() rows now carry numeric props (row[0], row[1]) ✔\n" +
        "  - but the row is NOT array-like (no `length`) and NOT iterable ✘\n" +
        "  - and Object.keys()/Object.values() still collapse duplicate column names ✘\n" +
        "  - so Array.from(row) -> [], [...row] throws, Object.values(row) -> short array.\n" +
        "  - @libsql/client rows ARE array-like, so sqlite-proxy/Drizzle work there but not on Turso.\n" +
        "  - raw(true).all() is currently the only reliable positional accessor on Turso.",
    )
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function runLibsql(): Promise<ReproResult> {
  const dbPath = join(workDir, "libsql.db")
  const client = Libsql.createClient({ url: `file://${dbPath}` })

  try {
    await createSchema({
      execute: (sql, args = []) => client.execute({ sql, args }),
    })

    const result = await client.execute(`
      select role.path, org_unit.path
      from role
      join org_unit
    `)

    return {
      label: "@libsql/client",
      objectRow: result.rows[0] as RowLike | undefined,
    }
  } finally {
    client.close()
  }
}

async function runTurso(): Promise<ReproResult> {
  const dbPath = join(workDir, "turso.db")
  const db = await connect(dbPath, { experimental: ["multiprocess_wal"] })

  try {
    await db.all("pragma journal_mode = mvcc", [])
    await createSchema({
      execute: (sql, args = []) => db.all(sql, args),
    })

    const objectRows = await db.all(
      `
        select role.path, org_unit.path
        from role
        join org_unit
      `,
      [],
    )

    const statement = await db.prepare(`
      select role.path, org_unit.path
      from role
      join org_unit
    `)

    try {
      statement.raw(true)
      const rawRows = await statement.all([])

      return {
        label: "@tursodatabase/database db.all()",
        objectRow: objectRows[0] as RowLike | undefined,
        rawRows,
      }
    } finally {
      statement.close()
    }
  } finally {
    await db.close()
  }
}

async function createSchema(client: {
  readonly execute: (sql: string, args?: string[]) => Promise<unknown>
}) {
  await client.execute("create table role (id text primary key, path text not null)")
  await client.execute("create table org_unit (id text primary key, path text not null)")
  await client.execute("insert into role values (?, ?)", ["role-1", "/Employee"])
  await client.execute("insert into org_unit values (?, ?)", ["org-1", "/"])
}

function printResult(result: ReproResult) {
  const row = result.objectRow

  console.log(`\n${result.label}`)
  console.log("  Object.keys(row):", JSON.stringify(Object.keys(row ?? {})))
  console.log("  Object.values(row):", JSON.stringify(Object.values(row ?? {})))
  console.log(
    "  Object.getOwnPropertyNames(row):",
    JSON.stringify(Object.getOwnPropertyNames(row ?? {})),
  )
  console.log(
    "  row.length:",
    JSON.stringify((row as { length?: unknown } | undefined)?.length),
  )
  console.log(
    "  Array.from(row):",
    JSON.stringify(arrayFromRow(row)),
  )
  console.log(
    "  iterable:",
    typeof (row as { [Symbol.iterator]?: unknown } | undefined)?.[
      Symbol.iterator
    ] === "function",
  )
  console.log("  row.path:", JSON.stringify(row?.path))
  console.log("  row[0]:", JSON.stringify(row?.[0]))
  console.log("  row[1]:", JSON.stringify(row?.[1]))

  if (result.rawRows) {
    console.log("  raw(true).all():", JSON.stringify(result.rawRows))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
