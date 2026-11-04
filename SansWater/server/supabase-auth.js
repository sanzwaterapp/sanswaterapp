import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export function authCookie(req, name) {
  const value = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
  try {
    return value ? decodeURIComponent(value) : "";
  } catch {
    return "";
  }
}

function unavailable() {
  return Object.assign(
    new Error("Layanan login belum dapat dihubungi. Coba kembali."),
    { status: 503 },
  );
}
function temporary(error) {
  return (
    !error.status ||
    error.status >= 500 ||
    error.name === "AuthRetryableFetchError"
  );
}

export function createSupabaseAuth(options = {}) {
  const provider = options.provider ?? process.env.AUTH_PROVIDER ?? "local";
  if (provider === "local") return null;
  if (provider !== "supabase")
    throw new Error("AUTH_PROVIDER harus local atau supabase.");
  const url = options.url ?? process.env.SUPABASE_URL;
  const key = options.key ?? process.env.SUPABASE_ANON_KEY;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL belum benar.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error(
      "SUPABASE_URL harus origin HTTPS tanpa path atau kredensial.",
    );
  let role;
  try {
    role = JSON.parse(
      Buffer.from(key.split(".")[1], "base64url").toString(),
    ).role;
  } catch {
    /* Publishable keys are not JWTs. */
  }
  if (!key || (!key.startsWith("sb_publishable_") && role !== "anon"))
    throw new Error(
      "Gunakan publishable/anon key untuk login; jangan gunakan service_role atau secret key.",
    );
  const makeClient =
    options.clientFactory ??
    (() =>
      createClient(parsed.origin, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: (input, init = {}) =>
            (options.fetchImpl ?? fetch)(input, {
              ...init,
              signal: init.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
                : AbortSignal.timeout(10000),
            }),
        },
      }));
  const refreshes = new Map();
  const cookie = (name, value, age) =>
    `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${(options.secure ?? process.env.SECURE_COOKIE === "true") ? "; Secure" : ""}`;
  const clearCookies = () => [
    cookie("depot_sb_access", "", 0),
    cookie("depot_sb_refresh", "", 0),
  ];
  const cookies = (session) => [
    cookie(
      "depot_sb_access",
      session.access_token,
      Math.min(43200, session.expires_in || 3600),
    ),
    cookie("depot_sb_refresh", session.refresh_token, 43200),
  ];
  async function check(access) {
    try {
      const { data, error } = await makeClient().auth.getUser(access);
      if (error) {
        if (temporary(error)) throw unavailable();
        return null;
      }
      return data.user?.id ? data.user : null;
    } catch (error) {
      if (error.status === 503) throw error;
      throw unavailable();
    }
  }
  async function refresh(token) {
    const fingerprint = createHash("sha256").update(token).digest("hex");
    if (!refreshes.has(fingerprint)) {
      const pending = (async () => {
        try {
          const { data, error } = await makeClient().auth.refreshSession({
            refresh_token: token,
          });
          if (error) {
            if (temporary(error)) throw unavailable();
            return null;
          }
          return data.session;
        } catch (error) {
          if (error.status === 503) throw error;
          throw unavailable();
        }
      })();
      refreshes.set(fingerprint, pending);
      // Retain only in-flight refreshes, never persist tokens in the app database or browser JS storage.
      pending.finally(() => refreshes.delete(fingerprint)).catch(() => {});
    }
    return refreshes.get(fingerprint);
  }
  return {
    cookies,
    clearCookies,
    async signIn(email, password) {
      if (
        typeof email !== "string" ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== "string" ||
        !password ||
        password.length > 200
      )
        throw Object.assign(
          new Error("Isi email dan kata sandi akun Supabase."),
          { status: 400 },
        );
      try {
        const { data, error } = await makeClient().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          if (temporary(error)) throw unavailable();
          throw Object.assign(new Error("Email atau kata sandi belum benar."), {
            status: 401,
          });
        }
        if (
          !data.user?.id ||
          !data.session?.access_token ||
          !data.session?.refresh_token
        )
          throw unavailable();
        return data;
      } catch (error) {
        if ([400, 401, 503].includes(error.status)) throw error;
        throw unavailable();
      }
    },
    async verify(req) {
      const access = authCookie(req, "depot_sb_access");
      if (access) {
        const user = await check(access);
        if (user) return { user, session: null };
      }
      const token = authCookie(req, "depot_sb_refresh");
      if (!token) return null;
      const session = await refresh(token);
      if (!session?.access_token || !session.refresh_token) return null;
      const user = await check(session.access_token);
      return user ? { user, session } : null;
    },
    async signOut(req) {
      const access = authCookie(req, "depot_sb_access");
      if (!access) return;
      try {
        await makeClient().auth.admin.signOut(access, "local");
      } catch {
        /* The app's own session is revoked even if Supabase is unavailable. */
      }
    },
  };
}
