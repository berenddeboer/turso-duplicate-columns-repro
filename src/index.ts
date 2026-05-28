import * as Libsql from "@libsql/client"
import { connect } from "@tursodatabase/database"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

type RowLike = Record<string, unknown> & {
  readonly [index: number]: unknown
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

    const libsqlPreservesPositions =
      libsql.objectRow?.[0] === "/Employee" && libsql.objectRow?.[1] === "/"
    const tursoLosesPositions =
      turso.objectRow?.[0] === undefined && turso.objectRow?.[1] === undefined
    const tursoRawPreservesPositions =
      JSON.stringify(turso.rawRows) === JSON.stringify([["/Employee", "/"]])

    if (!libsqlPreservesPositions) {
      throw new Error("libsql did not expose the duplicate columns positionally")
    }

    if (!tursoLosesPositions) {
      throw new Error(
        "Turso db.all() exposed positional values; this repro may no longer reproduce",
      )
    }

    if (!tursoRawPreservesPositions) {
      throw new Error("Turso raw(true) did not return both positional values")
    }

    console.log("Observed difference: libsql keeps positional row values; Turso db.all() does not.")
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
