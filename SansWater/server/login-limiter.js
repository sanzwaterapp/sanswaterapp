import { createHash } from "node:crypto";

// Separate from business revisions: failed login attempts survive instance
// replacement without triggering state downloads on all connected devices.
export function createLoginLimiter(
  pool,
  { schema = "depot_private", clock = Date.now } = {},
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error("Invalid limiter schema");
  return {
    async consume(username) {
      const value =
        typeof username === "string" ? username.trim().toLowerCase() : "";
      if (!value || value.length > 120) return;
      const key = createHash("sha256")
        .update("login:" + value)
        .digest("hex");
      const now = clock();
      let result;
      try {
        result = await pool.query({
          text: `INSERT INTO "${schema}".login_limits AS old (key,window_start,attempts)
            VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET
            attempts=CASE WHEN old.window_start<=$2-900000 THEN 1 ELSE LEAST(old.attempts+1,11) END,
            window_start=CASE WHEN old.window_start<=$2-900000 THEN $2 ELSE old.window_start END
            RETURNING attempts`,
          values: [key, now],
          query_timeout: 5000,
        });
        // Bound storage for unknown usernames; hashes carry no plaintext names.
        await pool.query({
          text: `DELETE FROM "${schema}".login_limits WHERE key IN
            (SELECT key FROM "${schema}".login_limits WHERE window_start<$1 LIMIT 100)`,
          values: [now - 86400000],
          query_timeout: 5000,
        });
      } catch {
        throw Object.assign(
          new Error("Pemeriksaan login belum tersedia. Coba kembali."),
          { status: 503 },
        );
      }
      if (result.rows[0].attempts > 10)
        throw Object.assign(
          new Error("Terlalu banyak percobaan. Coba kembali dalam 15 menit."),
          { status: 429 },
        );
    },
  };
}
