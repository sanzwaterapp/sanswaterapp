import { GasPhotoClient, photoHash } from "./gas-photo-client.js";
import { transaction } from "./database.js";
import { createPhotoCache } from "./photo-cache.js";
import { resolve } from "node:path";

export function createPhotoStorage(db, options = {}) {
  const driver = options.driver ?? process.env.PHOTO_STORAGE ?? "local";
  if (!["local", "gas"].includes(driver))
    throw new Error("PHOTO_STORAGE hanya local atau gas.");
  const url = options.url ?? process.env.GAS_PHOTO_URL;
  const secret = options.secret ?? process.env.GAS_PHOTO_SECRET;
  const client =
    options.client ||
    (url && secret
      ? new GasPhotoClient({
          url,
          secret,
          fetchImpl: options.fetchImpl,
          timeout: options.timeout ?? 25000,
        })
      : null);
  if (driver === "gas" && !client)
    throw new Error(
      "Lengkapi GAS_PHOTO_URL dan GAS_PHOTO_SECRET sebelum mengaktifkan PHOTO_STORAGE=gas.",
    );
  const enabled = driver === "gas",
    clock = options.clock || Date.now;
  const databaseFile = db
    .prepare("PRAGMA database_list")
    .all()
    .find((row) => row.name === "main")?.file;
  const cachePath =
    options.cachePath ??
    process.env.PHOTO_CACHE_PATH ??
    (databaseFile ? databaseFile + ".photo-cache.sqlite" : null);
  const cacheMaxMB = Number(process.env.PHOTO_CACHE_MAX_MB ?? 256);
  if (!Number.isSafeInteger(cacheMaxMB) || cacheMaxMB < 0 || cacheMaxMB > 4096)
    throw new Error("PHOTO_CACHE_MAX_MB harus bilangan bulat 0 sampai 4096.");
  const normalizedPath = (path) =>
    process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  if (
    cachePath &&
    databaseFile &&
    normalizedPath(cachePath) === normalizedPath(databaseFile)
  )
    throw new Error("File cache foto harus terpisah dari database transaksi.");
  const cache =
    options.cache === false
      ? null
      : options.cache ||
        (cachePath
          ? createPhotoCache({
              path: cachePath,
              maxBytes: options.cacheMaxBytes ?? cacheMaxMB * 1024 * 1024,
              clock,
            })
          : null);
  const reads = new Map();
  let preparation = null;
  let timer = null,
    maintenanceTimer = null,
    running = null,
    stopped = true;
  function queue(photo) {
    if (!enabled) return;
    if (preparation) {
      const signature = photoHash(photo.bytes);
      if (preparation.reuse) {
        const saved = preparation.photos[preparation.cursor++];
        if (
          !saved ||
          saved.id !== photo.id ||
          saved.mime !== photo.mime ||
          saved.sha256 !== signature ||
          !saved.remote
        )
          throw Object.assign(
            new Error("Bukti foto berubah. Coba simpan kembali."),
            { status: 409 },
          );
        db.prepare(
          "INSERT INTO photo_storage(photo_id,status,sha256,byte_size,file_id,uploaded_at) VALUES(?,'uploaded',?,?,?,?)",
        ).run(
          photo.id,
          signature,
          photo.bytes.length,
          saved.remote.fileId,
          new Date(clock()).toISOString(),
        );
        db.prepare("UPDATE photos SET bytes=X'' WHERE id=?").run(photo.id);
        return;
      }
      preparation.photos.push({ ...photo, sha256: signature });
      preparation.cursor++;
    }
    db.prepare(
      "INSERT OR IGNORE INTO photo_storage(photo_id,status,sha256,byte_size) VALUES(?,'pending',?,?)",
    ).run(photo.id, photoHash(photo.bytes), photo.bytes.length);
  }
  function queueExisting() {
    if (!enabled)
      throw new Error("Aktifkan konfigurasi GAS sebelum migrasi foto.");
    return transaction(db, () => {
      let count = 0;
      for (const row of db
        .prepare(
          "SELECT p.id,p.bytes FROM photos p WHERE length(p.bytes)>0 AND NOT EXISTS(SELECT 1 FROM photo_storage s WHERE s.photo_id=p.id)",
        )
        .iterate()) {
        queue({ id: row.id, bytes: Buffer.from(row.bytes) });
        count++;
      }
      return count;
    });
  }
  function pendingPhotos(limit) {
    return db
      .prepare(
        "SELECT p.*,s.sha256,s.byte_size,s.attempts FROM photo_storage s JOIN photos p ON p.id=s.photo_id WHERE s.status='pending' AND s.next_retry_at<=? ORDER BY s.rowid LIMIT ?",
      )
      .all(clock(), limit);
  }
  async function processOne(row = pendingPhotos(1)[0]) {
    if (!row) return null;
    try {
      const bytes = Buffer.from(row.bytes);
      if (bytes.length !== row.byte_size || photoHash(bytes) !== row.sha256)
        throw Object.assign(new Error("Salinan lokal foto berubah."), {
          code: "LOCAL_VERIFY",
        });
      const remote = await client.put({ id: row.id, mime: row.mime, bytes });
      // Read back and verify before releasing the local blob.
      const verified = await client.get(remote);
      cache?.put(remote, verified);
      transaction(db, () => {
        db.prepare(
          "UPDATE photo_storage SET status='uploaded',file_id=?,uploaded_at=?,last_error=NULL WHERE photo_id=?",
        ).run(remote.fileId, new Date(clock()).toISOString(), row.id);
        db.prepare("UPDATE photos SET bytes=X'' WHERE id=?").run(row.id);
      });
      return { id: row.id, ok: true };
    } catch (error) {
      const attempts = row.attempts + 1;
      const code = /^[A-Z_]{1,40}$/.test(error.code || "")
        ? error.code
        : "GAS_UNAVAILABLE";
      db.prepare(
        "UPDATE photo_storage SET attempts=?,last_error=?,next_retry_at=? WHERE photo_id=?",
      ).run(
        attempts,
        code,
        clock() + Math.min(3600000, 5000 * 2 ** Math.min(attempts - 1, 10)),
        row.id,
      );
      return { id: row.id, ok: false, code };
    }
  }
  function syncOnce() {
    if (!enabled) return Promise.resolve(null);
    if (running) return running;
    running = processOne().finally(() => {
      running = null;
    });
    return running;
  }
  async function loop() {
    if (stopped) return;
    try {
      await syncOnce();
    } catch {
      /* Keep the server alive if local storage is temporarily busy. */
    }
    if (!stopped) {
      timer = setTimeout(loop, options.interval || 2000);
      timer.unref();
    }
  }
  return {
    enabled,
    cache,
    queue,
    queueExisting,
    syncOnce,
    allocateId() {
      if (!preparation) return null;
      if (preparation.reuse)
        return preparation.photos[preparation.cursor]?.id || null;
      // Stable across retries and instances, distinct for each photo in a save.
      const hex = photoHash(
        Buffer.from(preparation.key + ":" + preparation.cursor),
      ).slice(0, 32);
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-");
    },
    capture(key, work) {
      const previous = preparation;
      preparation = { key, cursor: 0, photos: [] };
      try {
        const value = work();
        return { value, photos: preparation.photos };
      } finally {
        preparation = previous;
      }
    },
    reuse(photos, work) {
      const previous = preparation;
      preparation = { reuse: true, photos, cursor: 0 };
      try {
        return work();
      } finally {
        preparation = previous;
      }
    },
    async uploadPrepared(photos) {
      // No business DB reads/writes while remote I/O is in flight.
      for (let index = 0; index < photos.length; index += 3) {
        const results = await Promise.allSettled(
          photos.slice(index, index + 3).map(async (photo) => {
            const remote = await client.put(photo);
            const verified = await client.get(remote);
            if (
              remote.photoId !== photo.id ||
              remote.sha256 !== photo.sha256 ||
              remote.size !== photo.bytes.length ||
              remote.mime !== photo.mime ||
              verified.mime !== photo.mime ||
              photoHash(verified.binary) !== photo.sha256
            )
              throw new Error("Foto tidak lolos verifikasi.");
            cache?.put(remote, verified);
            photo.remote = remote;
          }),
        );
        if (results.some((result) => result.status === "rejected"))
          throw Object.assign(
            new Error("Foto belum tersimpan di GAS. Coba simpan kembali."),
            { status: 503 },
          );
      }
    },
    async flushPending() {
      if (!enabled)
        throw new Error("Penyimpanan Supabase memerlukan foto GAS.");
      // Every acknowledged photo is already in Drive. No photo bytes enter PG.
      for (
        let batch = pendingPhotos(3);
        batch.length;
        batch = pendingPhotos(3)
      ) {
        // Wait for every in-flight upload before the caller can roll back its scope.
        const results = await Promise.allSettled(
          batch.map((row) => processOne(row)),
        );
        if (
          results.some(
            (result) => result.status === "rejected" || !result.value.ok,
          )
        )
          throw Object.assign(
            new Error("Foto belum tersimpan di GAS. Coba simpan kembali."),
            { status: 503 },
          );
      }
      if (
        db
          .prepare("SELECT 1 FROM photos WHERE length(bytes)>0 LIMIT 1")
          .get() ||
        db
          .prepare("SELECT 1 FROM photo_storage WHERE status='pending' LIMIT 1")
          .get()
      )
        throw Object.assign(
          new Error("Masih ada foto yang belum terverifikasi di GAS."),
          { status: 503 },
        );
    },
    health: () => {
      if (!client) throw new Error("Konfigurasi GAS belum diisi.");
      return client.health();
    },
    start() {
      if (cache && client && !maintenanceTimer && options.autoStart !== false) {
        cache.maintain();
        maintenanceTimer = setInterval(() => cache.maintain(), 3600000);
        maintenanceTimer.unref();
      }
      if (
        enabled &&
        stopped &&
        options.autoStart !== false &&
        !options.uploadOnCommit
      ) {
        stopped = false;
        timer = setTimeout(loop, 1000);
        timer.unref();
      }
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(maintenanceTimer);
      maintenanceTimer = null;
      if (running) await running;
      await Promise.allSettled([...reads.values()]);
      cache?.close();
    },
    prepareRead(photo) {
      // Capture immutable metadata while the caller still owns its data scope.
      // The returned reader performs remote I/O after that scope is released.
      const remote = photo.bytes?.length
        ? null
        : (db
            .prepare(
              "SELECT * FROM photo_storage WHERE photo_id=? AND status='uploaded'",
            )
            .get(photo.id) ?? null);
      return () => this.read(photo, remote);
    },
    async read(photo, snapshot) {
      if (photo.bytes?.length)
        return { binary: Buffer.from(photo.bytes), mime: photo.mime };
      const remote =
        snapshot === undefined
          ? db
              .prepare(
                "SELECT * FROM photo_storage WHERE photo_id=? AND status='uploaded'",
              )
              .get(photo.id)
          : snapshot;
      if (!remote)
        throw Object.assign(
          new Error(
            "Foto Drive belum dapat diakses. Periksa konfigurasi penyimpanan foto pada server.",
          ),
          { status: 503 },
        );
      const expected = {
        photoId: photo.id,
        fileId: remote.file_id,
        sha256: remote.sha256,
        size: remote.byte_size,
        mime: photo.mime,
      };
      const cached = cache?.get(expected);
      if (cached) return cached;
      if (!client)
        throw Object.assign(
          new Error("Konfigurasi GAS belum tersedia untuk mengambil foto ini."),
          { status: 503 },
        );
      const key =
        expected.photoId + ":" + expected.sha256 + ":" + expected.fileId;
      if (reads.has(key)) return reads.get(key);
      const request = (async () => {
        const photo = await client.get(expected);
        cache?.put(expected, photo);
        return photo;
      })();
      reads.set(key, request);
      try {
        return await request;
      } finally {
        reads.delete(key);
      }
    },
  };
}
