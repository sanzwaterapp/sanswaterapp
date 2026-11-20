import { createPrivateKey, sign } from "node:crypto";

const topic = "sanswater:updates";
const ttl = 300;
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function createRealtimeSession(env = process.env) {
  const jwk = env.DEPOT_REALTIME_SIGNING_JWK?.trim();
  if (!jwk) return null;

  try {
    const url = new URL(env.SUPABASE_URL);
    const publicKey = env.SUPABASE_ANON_KEY?.trim();
    const anon =
      publicKey?.startsWith("sb_publishable_") ||
      JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url")).role ===
        "anon";
    const key = JSON.parse(jwk);
    if (
      !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(env.SUPABASE_URL) ||
      !anon ||
      key.kty !== "EC" ||
      key.crv !== "P-256" ||
      !key.d ||
      typeof key.kid !== "string" ||
      !key.kid
    )
      throw new Error();

    const privateKey = createPrivateKey({ key, format: "jwk" });
    const header = encode({ alg: "ES256", typ: "JWT", kid: key.kid });
    return (userId) => {
      const iat = Math.floor(Date.now() / 1000);
      const payload = encode({
        iss: url.origin + "/auth/v1",
        aud: "authenticated",
        sub: userId,
        role: "depot_realtime_listener",
        depot_realtime: topic,
        iat,
        exp: iat + ttl,
      });
      const data = `${header}.${payload}`;
      const signature = sign("sha256", Buffer.from(data), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      });
      return {
        url: url.origin,
        publicKey,
        topic,
        token: `${data}.${signature.toString("base64url")}`,
        validFor: ttl,
      };
    };
  } catch {
    console.warn(
      "Konfigurasi Supabase Realtime belum valid. Aplikasi akan memeriksa perubahan secara berkala.",
    );
    return null;
  }
}
