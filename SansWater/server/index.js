import { createApp } from "./app.js";
import { existsSync } from "node:fs";
import { openDatabase } from "./database.js";
import { createCloudStore } from "./cloud-store.js";
import { runtimeConfig } from "./runtime-config.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const { provider, port, host } = runtimeConfig();
let db, cloud;
if (provider === "supabase") {
  db = openDatabase(
    process.env.CLOUD_CACHE_PATH || "./data/supabase-projection.sqlite",
  );
  cloud = await createCloudStore(db);
}
const dev = process.argv.includes("--dev");
let vite;
if (dev) {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
}
const app = createApp({
  db,
  cloud,
  dev,
  staticHandler: vite ? (req, res) => vite.middlewares(req, res) : null,
});
app.server.listen(port, host, () =>
  console.log(`SANZ WATER: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (vite) await vite.close();
    await app.close();
    process.exit(0);
  });
