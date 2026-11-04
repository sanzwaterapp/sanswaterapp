import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";
import { openDatabase } from "./database.js";
import { createCloudStore, createPostgresPool } from "./cloud-store.js";
import { runtimeConfig } from "./runtime-config.js";
import { createLoginLimiter } from "./login-limiter.js";

export function vercelConfig(env = process.env) {
  runtimeConfig({ ...env, NODE_ENV: "production" });
  if (env.DATA_PROVIDER !== "supabase" || env.AUTH_PROVIDER !== "local")
    throw new Error(
      "Vercel memerlukan DATA_PROVIDER=supabase dan AUTH_PROVIDER=local.",
    );
  if (!env.DATABASE_URL || !env.GAS_PHOTO_URL || !env.GAS_PHOTO_SECRET)
    throw new Error(
      "Lengkapi konfigurasi database dan foto pada environment server.",
    );
  if (env.VERCEL_ENV === "preview" && env.ALLOW_PREVIEW_DATABASE !== "true")
    throw new Error(
      "API Preview dinonaktifkan. Gunakan database uji terpisah sebelum mengaktifkannya.",
    );
  const photoCacheMB = Number(env.PHOTO_CACHE_MAX_MB ?? 96);
  if (!Number.isInteger(photoCacheMB) || photoCacheMB < 0 || photoCacheMB > 128)
    throw new Error("Cache foto Vercel harus 0–128 MiB.");
  return { photoCacheMB };
}

// A single bootstrap promise is reused by concurrent invocations of this
// function instance. No user data or credentials are bundled into the build.
export function lazyRuntime(initialize) {
  let pending;
  return () => {
    if (!pending)
      pending = Promise.resolve()
        .then(initialize)
        .catch((error) => {
          pending = undefined;
          throw error;
        });
    return pending;
  };
}

export async function createVercelRuntime() {
  const { photoCacheMB } = vercelConfig();
  const directory = await mkdtemp(join(tmpdir(), "sanswater-"));
  let db, cloud, pool;
  try {
    // SQLite contains a disposable projection only. A new instance reconstructs
    // it from Supabase; success is still acknowledged only after PG COMMIT.
    db = openDatabase(":memory:");
    pool = createPostgresPool();
    cloud = await createCloudStore(db, { pool });
    const app = createApp({
      db,
      cloud,
      auth: { provider: "local" },
      allowSetup: false,
      maxBodyBytes: 4_000_000,
      maxResponseBytes: 4_000_000,
      acceptParsedBody: true,
      eventsMaxAge: 240000,
      loginLimiter: createLoginLimiter(pool),
      photoStorage: {
        driver: "gas",
        cachePath: join(directory, "photos.sqlite"),
        cacheMaxBytes: photoCacheMB * 1024 * 1024,
        autoStart: false,
        timeout: 12000,
      },
    });
    return {
      handle: app.handle,
      async close() {
        await app.close();
        await pool.end();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await cloud?.close();
    if (db?.isOpen) db.close();
    await pool?.end();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function apiRequestUrl(value) {
  const url = new URL(value, "http://localhost");
  const routes = url.searchParams.getAll("__route");
  if (routes.length) {
    if (routes.length !== 1 || !/^[a-zA-Z0-9_/-]{1,220}$/.test(routes[0]))
      throw Object.assign(new Error("Alamat API belum benar."), {
        status: 400,
      });
    url.pathname = "/api/" + routes[0];
    url.searchParams.delete("__route");
  }
  if (!url.pathname.startsWith("/api/"))
    throw Object.assign(new Error("Layanan tidak ditemukan."), { status: 404 });
  return url.pathname + url.search;
}

export function createVercelHandler(
  getRuntime = lazyRuntime(createVercelRuntime),
) {
  return async (req, res) => {
    try {
      req.url = apiRequestUrl(req.url);
      // Do not release an invocation while a streamed response is still open.
      const finished = new Promise((done) => {
        res.once("finish", done);
        res.once("close", done);
      });
      await (await getRuntime()).handle(req, res);
      await finished;
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        error.status === 400 || error.status === 404 ? error.status : 503;
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(
        JSON.stringify({
          error:
            status === 503
              ? "Server belum dapat dihubungi. Periksa konfigurasi deployment atau coba kembali."
              : error.message,
        }),
      );
      // Never log connection strings, request bodies, tokens, or GAS secrets.
      if (status === 503)
        console.error(
          "SansWater API unavailable",
          error.code || "RUNTIME_INIT",
        );
    }
  };
}
