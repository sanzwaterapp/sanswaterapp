export function runtimeConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const provider = env.DATA_PROVIDER || "sqlite";
  if (!["sqlite", "supabase"].includes(provider))
    throw new Error("DATA_PROVIDER hanya sqlite atau supabase.");
  if (production && !env.DATA_PROVIDER)
    throw new Error(
      "Isi DATA_PROVIDER secara eksplisit sebelum menjalankan produksi.",
    );
  if (provider === "supabase" && env.PHOTO_STORAGE !== "gas")
    throw new Error("Supabase memerlukan PHOTO_STORAGE=gas.");
  if (production) {
    let origin;
    try {
      origin = new URL(env.APP_ORIGIN);
    } catch {
      throw new Error("APP_ORIGIN produksi harus domain HTTPS aplikasi.");
    }
    if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN)
      throw new Error(
        "APP_ORIGIN produksi harus origin HTTPS tanpa path atau slash akhir.",
      );
    if (env.SECURE_COOKIE !== "true")
      throw new Error(
        "Produksi memerlukan SECURE_COOKIE=true agar sesi hanya dikirim lewat HTTPS.",
      );
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < (production ? 1 : 0) || port > 65535)
    throw new Error("PORT server belum valid.");
  return {
    provider,
    port,
    host: env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
  };
}
