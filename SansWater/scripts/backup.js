import { backup } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../server/database.js";
if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.DATA_PROVIDER === "supabase") {
  process.argv[2] = "backup";
  await import("./cloud-data.js");
} else {
  const databasePath = process.env.DB_PATH || "./data/depot.sqlite";
  if (!existsSync(databasePath))
    throw new Error(
      "Basis data belum ditemukan. Jalankan aplikasi sebelum membuat cadangan.",
    );
  mkdirSync("backups", { recursive: true });
  const source = databasePath,
    target = resolve(
      "backups",
      "depot-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite",
    ),
    db = openDatabase(source);
  try {
    await backup(db, target);
    console.log("Cadangan tersimpan: " + target);
  } finally {
    db.close();
  }
}
