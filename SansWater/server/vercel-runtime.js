import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";
import { openDatabase } from "./database.js";
import { createCloudStore, createPostgresPool } from "./cloud-store.js";
import { runtimeConfig } from "./runtime-config.js";
import { createLoginLimiter } from "./login-limiter.js";
import { GasPhotoClient } from "./gas-photo-client.js";

const deploymentDefaults = Object.freeze({
  NODE_ENV: "production",
  DATA_PROVIDER: "supabase",
  AUTH_PROVIDER: "local",
  PHOTO_STORAGE: "gas",
  SECURE_COOKIE: "true",
  APP_ORIGIN: "https://sanswater.vercel.app",
  PHOTO_CACHE_MAX_MB: "96",
});
const secretFields = ["DATABASE_URL", "GAS_PHOTO_URL", "GAS_PHOTO_SECRET"];

function configError(fields, message) {
  return Object.assign(new Error(message), {
    deploymentCode: "DEPLOYMENT_CONFIG",
    deploymentFields: fields,
  });
}

export function resolveVercelEnvironment(env = process.env) {
  const resolved = { ...env };
  for (const [key, fallback] of Object.entries(deploymentDefaults)) {
    const value = env[key];
    resolved[key] =
      typeof value === "string" && value.trim() ? value.trim() : fallback;
  }
  // Only known template values fall back to the fixed canonical domain. Never
  // trust a request Host/Origin header to choose an allowed production origin.
  if (
    /^https:\/\/ganti[a-z-]*(?:\.vercel\.app)?\/?$/i.test(resolved.APP_ORIGIN)
  )
    resolved.APP_ORIGIN = deploymentDefaults.APP_ORIGIN;
  for (const key of secretFields)
    if (typeof resolved[key] === "string") resolved[key] = resolved[key].trim();
  return resolved;
}

export function vercelConfig(env = process.env) {
  env = resolveVercelEnvironment(env);
  try {
    runtimeConfig({ ...env, NODE_ENV: "production" });
  } catch {
    throw configError(
      ["DATA_PROVIDER", "PHOTO_STORAGE", "APP_ORIGIN", "SECURE_COOKIE", "PORT"],
      "Pengaturan server belum valid. Periksa DATA_PROVIDER, PHOTO_STORAGE, APP_ORIGIN, SECURE_COOKIE dan PORT di Vercel.",
    );
  }
  if (env.DATA_PROVIDER !== "supabase" || env.AUTH_PROVIDER !== "local")
    throw configError(
      ["DATA_PROVIDER", "AUTH_PROVIDER"],
      "Vercel memerlukan DATA_PROVIDER=supabase dan AUTH_PROVIDER=local.",
    );
  const missing = secretFields.filter((key) => !env[key]);
  if (missing.length)
    throw configError(
      missing,
      "Konfigurasi server belum lengkap. Isi environment Vercel: " +
        missing.join(", ") +
        ".",
    );
  try {
    const database = new URL(env.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !database.username ||
      !database.password ||
      !database.hostname
    )
      throw new Error();
  } catch {
    throw configError(
      ["DATABASE_URL"],
      "DATABASE_URL belum valid. Gunakan URI Transaction pooler dengan kredensial role backend.",
    );
  }
  try {
    new GasPhotoClient({
      url: env.GAS_PHOTO_URL,
      secret: env.GAS_PHOTO_SECRET,
    });
  } catch {
    throw configError(
      ["GAS_PHOTO_URL", "GAS_PHOTO_SECRET"],
      "Konfigurasi foto belum valid. Periksa GAS_PHOTO_URL /exec dan GAS_PHOTO_SECRET 64 karakter hex di Vercel.",
    );
  }
  if (env.VERCEL_ENV === "preview" && env.ALLOW_PREVIEW_DATABASE !== "true")
    throw configError(
      ["ALLOW_PREVIEW_DATABASE"],
      "API Preview dinonaktifkan. Gunakan database uji terpisah sebelum mengaktifkannya.",
    );
  const photoCacheMB = Number(env.PHOTO_CACHE_MAX_MB ?? 96);
  if (!Number.isInteger(photoCacheMB) || photoCacheMB < 0 || photoCacheMB > 128)
    throw configError(
      ["PHOTO_CACHE_MAX_MB"],
      "Cache foto Vercel harus 0–128 MiB.",
    );
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
  const environment = resolveVercelEnvironment();
  const { photoCacheMB } = vercelConfig(environment);
  // The application checks origin and secure cookies at request time. Apply
  // validated defaults there as well, rather than only validating a copy.
  for (const key of [...Object.keys(deploymentDefaults), ...secretFields])
    process.env[key] = environment[key];
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
    if (!error.deploymentCode)
      error.deploymentCode = cloud ? "APPLICATION_STARTUP" : "DATABASE_STARTUP";
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
              ? error.deploymentFields
                ? error.message
                : error.deploymentCode === "DATABASE_STARTUP"
                  ? "Database belum tersambung. Periksa DATABASE_URL di Vercel atau coba kembali."
                  : "Server belum dapat dihubungi. Periksa konfigurasi deployment atau coba kembali."
              : error.message,
          ...(status === 503
            ? {
                code: error.deploymentCode || "RUNTIME_INIT",
                ...(error.deploymentFields
                  ? { fields: error.deploymentFields }
                  : {}),
              }
            : {}),
        }),
      );
      // Never log connection strings, request bodies, tokens, or GAS secrets.
      if (status === 503)
        console.error(
          "SansWater API unavailable",
          error.deploymentCode || "RUNTIME_INIT",
          error.code || error.cause?.code || "NO_DETAIL",
        );
    }
  };
}
