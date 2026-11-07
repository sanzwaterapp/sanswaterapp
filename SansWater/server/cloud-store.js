import pg from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";

// Supabase is authoritative. SQLite is a disposable server-side projection used
// by the existing, constraint-checked business rules. Only changed rows travel
// over the network; an HTTP success is sent only after the Postgres COMMIT.
const LOCK = 731406211;
const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error("Invalid store identifier");
  return '"' + value + '"';
};
const unavailable = () =>
  Object.assign(
    new Error(
      "Supabase belum dapat dihubungi. Coba kembali dengan tombol yang sama.",
    ),
    { status: 503 },
  );

export function businessTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cloud_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
}

export function cloudRow(entity, row) {
  const { _rowid, ...payload } = row;
  if (entity === "photos") {
    if (payload.bytes?.length)
      throw new Error(
        "Foto harus terverifikasi di GAS sebelum disimpan ke Supabase.",
      );
    delete payload.bytes;
  }
  return { entity, row_id: _rowid, payload };
}

export function exportRows(db) {
  return businessTables(db).flatMap((entity) =>
    db
      .prepare(
        `SELECT rowid AS _rowid,* FROM ${identifier(entity)} ORDER BY rowid`,
      )
      .all()
      .map((row) => cloudRow(entity, row)),
  );
}

export function rowsDigest(rows) {
  const ordered = [...rows].sort(
    (a, b) => a.entity.localeCompare(b.entity) || a.row_id - b.row_id,
  );
  const normalized = ordered.map(({ entity, row_id, payload }) => ({
    entity,
    row_id: Number(row_id),
    payload:
      payload &&
      Object.fromEntries(
        Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)),
      ),
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function createPostgresPool({
  connectionString = process.env.DATABASE_URL,
  schema = "depot_private",
  ca,
} = {}) {
  identifier(schema);
  if (!connectionString) throw new Error("DATABASE_URL server belum diisi.");
  const parsed = new URL(connectionString);
  // TLS verification is mandatory; never silently accept an untrusted server.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    parsed.searchParams.delete(key);
  ca ??= process.env.DATABASE_CA_PATH
    ? readFileSync(process.env.DATABASE_CA_PATH, "utf8")
    : readFileSync(new URL("./certs/supabase-ca.crt", import.meta.url), "utf8");
  const pool = new pg.Pool({
    connectionString: parsed.href,
    ssl: { rejectUnauthorized: true, ca: [...rootCertificates, ca] },
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: true,
    maxLifetimeSeconds: 120,
    statement_timeout: 20000,
    query_timeout: 25000,
    application_name: "sanz-water",
  });
  pool.on("error", () =>
    console.error(
      "Koneksi Supabase terputus; permintaan berikutnya akan mencoba kembali.",
    ),
  );
  return pool;
}

export async function createCloudStore(
  db,
  {
    pool,
    schema = "depot_private",
    ownsPool = false,
    queueTimeoutMs = 20000,
    bootstrapBatchSize = 1000,
  } = {},
) {
  const namespace = identifier(schema);
  if (!pool) {
    pool = createPostgresPool({ schema });
    ownsPool = true;
  }
  const tables = businessTables(db),
    tableSet = new Set(tables);
  if (
    !Number.isInteger(bootstrapBatchSize) ||
    bootstrapBatchSize < 1 ||
    bootstrapBatchSize > 5000
  )
    throw new Error("Invalid bootstrap batch size");
  const columnsFor = new Map(
    tables.map((table) => [
      table,
      db
        .prepare(`PRAGMA table_info(${identifier(table)})`)
        .all()
        .map((row) => row.name),
    ]),
  );
  const deletes = new Map(
    tables.map((table) => [
      table,
      db.prepare(`DELETE FROM ${identifier(table)} WHERE rowid=?`),
    ]),
  );
  const inserts = new Map(
    tables.map((table) => {
      const columns = columnsFor.get(table);
      return [
        table,
        db.prepare(
          `INSERT INTO ${identifier(table)}(rowid,${columns.map(identifier).join(",")}) VALUES(${Array(
            columns.length + 1,
          )
            .fill("?")
            .join(",")})`,
        ),
      ];
    }),
  );
  const version = db.prepare("PRAGMA user_version").get().user_version;
  db.exec(`CREATE TABLE IF NOT EXISTS _cloud_state(id INTEGER PRIMARY KEY CHECK(id=1),store_id TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TEMP TABLE _cloud_dirty(entity TEXT NOT NULL,row_id INTEGER NOT NULL,PRIMARY KEY(entity,row_id));`);
  for (const entity of tables) {
    for (const action of ["INSERT", "UPDATE", "DELETE"]) {
      const ref = action === "DELETE" ? "OLD" : "NEW";
      db.exec(`CREATE TEMP TRIGGER ${identifier(`_cloud_${entity}_${action.toLowerCase()}`)} AFTER ${action} ON ${identifier(entity)} BEGIN
        INSERT OR IGNORE INTO _cloud_dirty VALUES('${entity}',${ref}.rowid); END;`);
    }
  }
  let tail = Promise.resolve(),
    closed = false,
    committedVersion = null;
  const acquire = async () => {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    let timer;
    try {
      await Promise.race([
        previous,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), queueTimeoutMs);
        }),
      ]);
    } catch (error) {
      // A timed-out ticket must release only AFTER its predecessor. Releasing
      // early would allow the next request to enter a still-busy SQLite scope.
      previous.then(release);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return release;
  };
  function applyRemote(rows, full) {
    db.exec("PRAGMA defer_foreign_keys=ON");
    if (full)
      for (const entity of [...tables].reverse())
        db.exec(`DELETE FROM ${identifier(entity)}`);
    // Remove all replaced rows before inserts so swapped unique keys are safe.
    for (const row of rows) {
      if (
        !tableSet.has(row.entity) ||
        !Number.isSafeInteger(Number(row.row_id))
      )
        throw new Error("Versi data Supabase belum didukung.");
      deletes.get(row.entity).run(Number(row.row_id));
    }
    for (const row of rows) {
      if (
        !tableSet.has(row.entity) ||
        !Number.isSafeInteger(Number(row.row_id))
      )
        throw new Error("Versi data Supabase belum didukung.");
      const rowId = Number(row.row_id);
      if (!row.payload) continue;
      const payload = { ...row.payload };
      if (row.entity === "photos") payload.bytes = Buffer.alloc(0);
      const expected = columnsFor.get(row.entity);
      if (
        Object.keys(payload).length !== expected.length ||
        expected.some((key) => !Object.hasOwn(payload, key))
      )
        throw new Error("Struktur data Supabase berbeda; perbarui aplikasi.");
      inserts
        .get(row.entity)
        .run(rowId, ...expected.map((key) => payload[key]));
    }
  }
  function changes() {
    return db
      .prepare("SELECT * FROM _cloud_dirty ORDER BY entity,row_id")
      .all()
      .map(({ entity, row_id }) => {
        const row = db
          .prepare(
            `SELECT rowid AS _rowid,* FROM ${identifier(entity)} WHERE rowid=?`,
          )
          .get(row_id);
        return row ? cloudRow(entity, row) : { entity, row_id, payload: null };
      });
  }
  async function begin() {
    if (closed) throw unavailable();
    const release = await acquire();
    let client,
      localOpen = false,
      remoteOpen = false,
      done = false,
      discard = false;
    const cleanup = () => {
      client?.release(
        discard ? new Error("Discard interrupted transaction") : undefined,
      );
      release();
    };
    async function rollback() {
      if (done) return;
      done = true;
      try {
        if (localOpen) db.exec("ROLLBACK");
      } finally {
        try {
          if (remoteOpen) await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
        cleanup();
      }
    }
    try {
      client = await pool.connect();
      // Batch setup and the snapshot to avoid one round trip per business SQL.
      remoteOpen = true;
      await client.query(
        `BEGIN; SET LOCAL lock_timeout='20s'; SET LOCAL idle_in_transaction_session_timeout='120s'; SELECT pg_advisory_xact_lock(${LOCK});`,
      );
      const local = db.prepare("SELECT * FROM _cloud_state WHERE id=1").get();
      const state = (
        await client.query(
          `SELECT s.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('entity',r.entity,'row_id',r.row_id,'payload',r.payload) ORDER BY r.entity,r.row_id)
        FROM ${namespace}.records r WHERE s.store_id=$1 AND $2<=s.revision AND r.revision > $2),'[]'::jsonb) AS records
        FROM ${namespace}.state s WHERE singleton=true`,
          [local?.store_id || null, local?.revision ?? -1],
        )
      ).rows[0];
      if (!state?.initialized)
        throw new Error(
          "Data awal belum diimpor ke Supabase. Jalankan db:import terlebih dahulu.",
        );
      if (state.schema_version !== version)
        throw new Error("Versi basis data Supabase berbeda dengan aplikasi.");
      const full =
        !local ||
        local.store_id !== state.store_id ||
        local.revision > Number(state.revision);
      const rows = state.records;
      db.exec("BEGIN IMMEDIATE");
      localOpen = true;
      applyRemote(rows, full);
      if (full) {
        // Cold instances still reconstruct the authoritative projection, but
        // never aggregate all history in one JSON/heap allocation. Tombstones
        // are unnecessary after a full clear and are excluded on this path.
        let cursor = null;
        for (;;) {
          const batch = (
            await client.query(
              `SELECT entity,row_id,payload FROM ${namespace}.records
             WHERE payload IS NOT NULL AND ($1::text IS NULL OR (entity,row_id)>($1::text,$2::bigint))
             ORDER BY entity,row_id LIMIT $3`,
              [cursor?.entity ?? null, cursor?.row_id ?? 0, bootstrapBatchSize],
            )
          ).rows;
          applyRemote(batch, false);
          if (batch.length < bootstrapBatchSize) break;
          cursor = batch.at(-1);
        }
      }
      db.prepare(
        "INSERT INTO _cloud_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET store_id=excluded.store_id,revision=excluded.revision",
      ).run(state.store_id, Number(state.revision));
      db.exec("DELETE FROM _cloud_dirty");
      return {
        rollback,
        async commit() {
          if (done) throw new Error("Store scope already closed");
          try {
            if (db.prepare("PRAGMA foreign_key_check").all().length)
              throw new Error("Relasi data belum konsisten.");
            const modified = changes();
            if (modified.length) {
              const next = Number(state.revision) + 1;
              await client.query(
                `WITH changed AS (INSERT INTO ${namespace}.records(entity,row_id,payload,revision)
                SELECT entity,row_id,payload,$2 FROM jsonb_to_recordset($1::jsonb) AS x(entity text,row_id bigint,payload jsonb)
                ON CONFLICT(entity,row_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision RETURNING row_id)
                UPDATE ${namespace}.state SET revision=$2 WHERE singleton=true`,
                [JSON.stringify(modified), next],
              );
              db.prepare("UPDATE _cloud_state SET revision=? WHERE id=1").run(
                next,
              );
            }
            await client.query("COMMIT");
            remoteOpen = false;
            db.exec("COMMIT");
            localOpen = false;
            done = true;
            committedVersion =
              state.store_id +
              ":" +
              (Number(state.revision) + (modified.length ? 1 : 0));
            cleanup();
            return committedVersion;
          } catch (error) {
            await rollback();
            // COMMIT acknowledgement can be lost. A subsequent request reloads
            // the authoritative revision and replays its idempotency record.
            throw Object.assign(
              new Error(
                "Hasil penyimpanan belum dapat dipastikan. Coba kembali dengan tombol yang sama untuk memeriksa, tanpa membuat transaksi baru.",
              ),
              { status: 503, cause: error },
            );
          }
        },
      };
    } catch (error) {
      await rollback();
      if (/Data awal|Versi basis|Struktur data/.test(error.message))
        throw error;
      throw Object.assign(unavailable(), { cause: error });
    }
  }
  const store = {
    begin,
    currentVersion: () => committedVersion,
    async probeVersion() {
      let client,
        broken = false;
      try {
        client = await pool.connect();
        const state = (
          await client.query({
            text: `SELECT store_id,revision,schema_version,initialized FROM ${namespace}.state WHERE singleton=true`,
            query_timeout: 3000,
          })
        ).rows[0];
        if (!state?.initialized || state.schema_version !== version)
          throw unavailable();
        return state.store_id + ":" + state.revision;
      } catch (error) {
        broken = true;
        throw Object.assign(unavailable(), { cause: error });
      } finally {
        client?.release(
          broken ? new Error("Discard failed revision connection") : undefined,
        );
      }
    },
    async health() {
      let client,
        broken = false;
      try {
        client = await pool.connect();
        const state = (
          await client.query({
            text: `SELECT initialized,schema_version FROM ${namespace}.state WHERE singleton=true`,
            query_timeout: 3000,
          })
        ).rows[0];
        if (!state?.initialized || state.schema_version !== version)
          throw unavailable();
      } catch (error) {
        broken = true;
        throw Object.assign(unavailable(), { cause: error });
      } finally {
        client?.release(
          broken ? new Error("Discard failed health connection") : undefined,
        );
      }
    },
    async run(work) {
      const scope = await begin();
      try {
        const value = await work();
        await scope.commit();
        return value;
      } catch (error) {
        await scope.rollback();
        throw error;
      }
    },
    async close() {
      closed = true;
      await tail;
      if (ownsPool) await pool.end();
    },
  };
  try {
    await store.run(() => {});
  } catch (error) {
    await store.close();
    throw error;
  }
  return store;
}
