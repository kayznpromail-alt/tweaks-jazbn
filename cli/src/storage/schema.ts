import { Database } from "bun:sqlite";
import { StorageError } from "./errors";

export function createLegacySchema(database: Database): void {
  database.run(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY NOT NULL, project TEXT NOT NULL, title TEXT NOT NULL, model TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0), messages TEXT NOT NULL
    );
    CREATE INDEX sessions_project_updated ON sessions (project, updated_at DESC, id DESC);
  `);
}

export function createClientGuards(database: Database): void {
  for (const table of ["settings", "sessions", "runs", "request_attempts", "tool_executions"]) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      database.run(`CREATE TRIGGER guard_${table}_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table}
        WHEN (SELECT foreign_keys FROM pragma_foreign_keys) = 0
        BEGIN SELECT RAISE(ABORT, 'legacy database writer blocked'); END`);
    }
  }
}

function canonical(sql: string): string {
  const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[a-zA-Z_][a-zA-Z0-9_]*|\d+|[^\s;]/g) ?? [];
  return JSON.stringify(tokens.map((token) => /^["']/.test(token) ? token : token.toLowerCase()));
}

export function compareSchema(database: Database, expected: Database): void {
  const select = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
  type Entry = { type: string; name: string; tbl_name: string; sql: string };
  const wanted = expected.query<Entry, []>(select).all();
  const actual = database.query<Entry, []>(select).all();
  if (wanted.length !== actual.length || wanted.some((row, index) => {
    const value = actual[index];
    return row.name !== value?.name || row.type !== value.type || row.tbl_name !== value.tbl_name
      || canonical(row.sql) !== canonical(value.sql);
  })) throw new StorageError("schema_version");
}

export function validateLegacySchema(database: Database): void {
  const expected = new Database(":memory:");
  try {
    createLegacySchema(expected);
    compareSchema(database, expected);
  } finally { expected.close(); }
}
