import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { backup } from "node:sqlite";
import { resolve } from "node:path";
import { openDatabase } from "../server/database.js";
import {
  createPostgresPool,
  createCloudStore,
  exportRows,
  rowsDigest,
} from "../server/cloud-store.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const command = process.argv[2];
if (!["import", "verify", "backup"].includes(command))
  throw new Error("Gunakan db:import, db:verify atau backup.");
const schema = "depot_private",
  pool = createPostgresPool();
let db, cloud;
try {
  if (command === "backup") {
    // Refresh a separate projection from Supabase, never copy a stale live cache.
    mkdirSync("backups", { recursive: true });
    const target = resolve(
      "backups",
      "supabase-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite",
    );
    db = openDatabase(":memory:");
    cloud = await createCloudStore(db, { pool });
    await cloud.run(() => {});
    await backup(db, target);
    console.log("Cadangan Supabase tersimpan: " + target);
  } else {
    const source = process.env.DB_PATH || "./data/depot.sqlite";
    if (!existsSync(source))
      throw new Error("Database sumber tidak ditemukan.");
    db = openDatabase(source);
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Relasi sumber belum konsisten.");
    const rows = exportRows(db),
      digest = rowsDigest(rows);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [731406211]);
      const state = (
        await client.query(`SELECT * FROM ${schema}.state WHERE singleton=true`)
      ).rows[0];
      if (command === "import") {
        if (
          state.initialized ||
          (await client.query(`SELECT 1 FROM ${schema}.records LIMIT 1`))
            .rowCount
        )
          throw new Error(
            "Supabase sudah berisi data. Impor ulang ditolak agar tidak menimpa transaksi.",
          );
        // Application must be stopped for this explicit, one-time import.
        const port = Number(process.env.PORT || 3000);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(1500),
          });
          if (response.ok)
            throw new Error("Hentikan server sebelum db:import.");
        } catch (error) {
          if (error.message === "Hentikan server sebelum db:import.")
            throw error;
        }
        for (let offset = 0; offset < rows.length; offset += 200)
          await client.query(
            `INSERT INTO ${schema}.records(entity,row_id,payload,revision)
            SELECT entity,row_id,payload,1 FROM jsonb_to_recordset($1::jsonb) AS x(entity text,row_id bigint,payload jsonb)`,
            [JSON.stringify(rows.slice(offset, offset + 200))],
          );
        await client.query(
          `UPDATE ${schema}.state SET initialized=true,revision=1,imported_at=now(),imported_digest=$1 WHERE singleton=true`,
          [digest],
        );
      }
      const remote = (
        await client.query(
          `SELECT entity,row_id,payload FROM ${schema}.records WHERE payload IS NOT NULL ORDER BY entity,row_id`,
        )
      ).rows;
      if (rowsDigest(remote) !== digest)
        throw new Error(
          "Verifikasi gagal: isi data sumber berbeda dari Supabase.",
        );
      await client.query("COMMIT");
      const counts = Object.fromEntries(
        [...new Set(rows.map((x) => x.entity))].map((entity) => [
          entity,
          rows.filter((x) => x.entity === entity).length,
        ]),
      );
      mkdirSync("backups", { recursive: true });
      writeFileSync(
        resolve("backups", "supabase-migration-verification.json"),
        JSON.stringify(
          {
            verifiedAt: new Date().toISOString(),
            digest,
            rows: rows.length,
            counts,
          },
          null,
          2,
        ),
      );
      console.log(
        "Terverifikasi identik: " +
          rows.length +
          " baris; " +
          counts.orders +
          " pesanan; " +
          counts.invoices +
          " tagihan; " +
          counts.payments +
          " pembayaran.",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} catch (error) {
  // Avoid driver messages that may include connection credentials or row data.
  console.error(
    error.code
      ? "Operasi Supabase gagal (" +
          error.code +
          "). Periksa koneksi dan konfigurasi server."
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await cloud?.close();
  if (db?.isOpen) db.close();
  await pool.end();
}
