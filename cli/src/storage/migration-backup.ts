import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { StorageError, safely } from "./errors";

/** serialize reads the pager snapshot including committed wal pages under the caller's write lock. */
export function backupBeforeMigration(database: Database, filename: string, version: number, targetVersion = version + 1): string | undefined {
  if (filename === ":memory:") return undefined;
  return safely("backup_failed", () => {
    const target = `${resolve(filename)}.before-v${targetVersion}-${randomUUID()}.bak`;
    const bytes = database.serialize();
    let fd: number | undefined;
    try {
      fd = openSync(target, "wx", 0o600);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (!written) throw new StorageError("backup_failed");
        offset += written;
      }
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (!readFileSync(target).equals(bytes)) throw new StorageError("backup_failed");
    const check = new Database(target, { readonly: true, strict: true });
    try {
      const result = check.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
      const savedVersion = check.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
      if (savedVersion !== version || result.length !== 1 || result[0].integrity_check !== "ok") {
        throw new StorageError("backup_failed");
      }
    } finally { check.close(); }
    return target;
  });
}
