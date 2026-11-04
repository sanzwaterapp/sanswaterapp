import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PHOTO_LIMIT, photoHash } from "./gas-photo-client.js";

// A separate, disposable server-side database. Never served as a public file.
export function createPhotoCache({
  path,
  maxBytes = 256 * 1024 * 1024,
  maxFiles = 3000,
  ttlMs = 30 * 86400000,
  clock = Date.now,
}) {
  if (
    !path ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    !Number.isSafeInteger(maxFiles) ||
    maxFiles < 1 ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1
  )
    throw new Error("Pengaturan cache foto belum valid.");
  let db;
  const metrics = { hits: 0, misses: 0, writes: 0, evictions: 0, errors: 0 };
  function connection() {
    if (db?.isOpen) return db;
    const file = resolve(path);
    mkdirSync(dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout=3000; PRAGMA auto_vacuum=INCREMENTAL;
      CREATE TABLE IF NOT EXISTS cached_photos(
        photo_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, sha256 TEXT NOT NULL,
        mime TEXT NOT NULL, bytes BLOB NOT NULL, verified_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS cached_photos_lru ON cached_photos(last_used,photo_id);`);
    return db;
  }
  function valid(meta, binary) {
    return binary.length === meta.size && photoHash(binary) === meta.sha256;
  }
  function removeExpired(database) {
    metrics.evictions += Number(
      database
        .prepare("DELETE FROM cached_photos WHERE verified_at<=?")
        .run(clock() - ttlMs).changes,
    );
  }
  function prune(database, incomingBytes = 0, incomingFiles = 0) {
    const size = database
      .prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(length(bytes)),0) bytes FROM cached_photos",
      )
      .get();
    if (
      size.bytes + incomingBytes <= maxBytes &&
      size.n + incomingFiles <= maxFiles
    )
      return;
    for (const row of database
      .prepare(
        "SELECT photo_id,length(bytes) bytes FROM cached_photos ORDER BY last_used,photo_id",
      )
      .all()) {
      database
        .prepare("DELETE FROM cached_photos WHERE photo_id=?")
        .run(row.photo_id);
      size.bytes -= row.bytes;
      size.n--;
      metrics.evictions++;
      if (
        size.bytes + incomingBytes <= maxBytes &&
        size.n + incomingFiles <= maxFiles
      )
        break;
    }
  }
  function maintenance() {
    if (!maxBytes) return;
    const database = connection();
    database.exec("BEGIN IMMEDIATE");
    try {
      removeExpired(database);
      prune(database);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    database.exec("PRAGMA incremental_vacuum(64)");
  }
  return {
    get(meta) {
      if (!maxBytes) return null;
      try {
        const database = connection();
        const row = database
          .prepare("SELECT * FROM cached_photos WHERE photo_id=?")
          .get(meta.photoId);
        if (
          row &&
          row.file_id === meta.fileId &&
          row.sha256 === meta.sha256 &&
          row.mime === meta.mime &&
          row.verified_at > clock() - ttlMs
        ) {
          const binary = Buffer.from(row.bytes);
          if (valid(meta, binary)) {
            database
              .prepare("UPDATE cached_photos SET last_used=? WHERE photo_id=?")
              .run(clock(), meta.photoId);
            metrics.hits++;
            return { binary, mime: meta.mime };
          }
        }
        if (row)
          database
            .prepare("DELETE FROM cached_photos WHERE photo_id=?")
            .run(meta.photoId);
      } catch {
        metrics.errors++;
      }
      metrics.misses++;
      return null;
    },
    put(meta, photo) {
      if (
        !maxBytes ||
        photo.binary.length > maxBytes ||
        photo.binary.length > PHOTO_LIMIT ||
        photo.mime !== meta.mime ||
        !valid(meta, photo.binary)
      )
        return false;
      try {
        const database = connection();
        database.exec("BEGIN IMMEDIATE");
        try {
          removeExpired(database);
          database
            .prepare("DELETE FROM cached_photos WHERE photo_id=?")
            .run(meta.photoId);
          prune(database, photo.binary.length, 1);
          database
            .prepare("INSERT INTO cached_photos VALUES(?,?,?,?,?,?,?)")
            .run(
              meta.photoId,
              meta.fileId,
              meta.sha256,
              meta.mime,
              photo.binary,
              clock(),
              clock(),
            );
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        metrics.writes++;
        database.exec("PRAGMA incremental_vacuum(64)");
        return true;
      } catch {
        metrics.errors++;
        return false;
      }
    },
    maintain() {
      try {
        maintenance();
      } catch {
        metrics.errors++;
      }
    },
    stats() {
      let size = { n: 0, bytes: 0 };
      if (db?.isOpen) {
        try {
          size = db
            .prepare(
              "SELECT COUNT(*) n,COALESCE(SUM(length(bytes)),0) bytes FROM cached_photos",
            )
            .get();
        } catch {
          metrics.errors++;
        }
      }
      return {
        ...metrics,
        files: size.n,
        bytes: size.bytes,
        maxBytes,
        maxFiles,
      };
    },
    close() {
      if (db?.isOpen) db.close();
    },
  };
}
