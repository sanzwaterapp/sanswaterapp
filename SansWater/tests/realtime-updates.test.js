import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { createRealtimeSession } from "../server/realtime-session.js";
import { connectLiveUpdates } from "../src/live-updates.js";

test("a valid depot session receives a signed, read-only Realtime credential", async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = { ...privateKey.export({ format: "jwk" }), kid: "realtime-test" };
  const app = createApp({
    dbPath: ":memory:",
    auth: { provider: "local" },
    photoStorage: { driver: "local", cache: false },
    liveEvents: false,
    realtimeSession: createRealtimeSession({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "sb_publishable_test",
      DEPOT_REALTIME_SIGNING_JWK: JSON.stringify(jwk),
    }),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const api = `http://127.0.0.1:${app.server.address().port}/api`;

  assert.equal((await fetch(`${api}/events`)).status, 404);
  assert.equal((await fetch(`${api}/realtime-session`)).status, 401);
  const setup = await fetch(`${api}/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Owner QA",
      username: "owner",
      password: "Realtime-QA-only",
      depotName: "Depot QA",
    }),
  });
  assert.equal(setup.status, 200);
  const headers = { cookie: setup.headers.get("set-cookie").split(";")[0] };
  const state = await (await fetch(`${api}/state`, { headers })).json();
  assert.equal(state.realtimeEnabled, true);
  const response = await fetch(`${api}/realtime-session`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const session = await response.json();
  const [header, payload, signature] = session.token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.role, "depot_realtime_listener");
  assert.equal(claims.sub, state.user.id);
  assert.equal(claims.depot_realtime, session.topic);
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      {
        key: publicKey,
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );

  await fetch(`${api}/logout`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(
    (await fetch(`${api}/realtime-session`, { headers })).status,
    401,
  );
});

test("missed revisions catch up at join and after disconnect, and hidden tabs stop", async () => {
  const state = {
    realtimeEnabled: true,
    syncVersion: "depot:1",
    today: "2026-11-20",
  };
  const documentImpl = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const windowImpl = new EventTarget();
  const calls = [];
  const timers = new Map();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let finishFirstProbe,
    transport,
    remote = "depot:2",
    closed = 0;
  const stop = connectLiveUpdates({
    documentImpl,
    windowImpl,
    getState: () => state,
    refresh: (version) => {
      state.syncVersion = version;
    },
    request: async (path) => {
      calls.push(path);
      if (path === "/realtime-session") return { validFor: 300 };
      if (!finishFirstProbe)
        return new Promise((resolve) => {
          finishFirstProbe = resolve;
        });
      return { version: remote, day: state.today };
    },
    subscribe: async (_, change, status) => {
      transport = { change, status };
      return () => {
        closed++;
      };
    },
    setTimer: (callback, ms) => {
      const id = Symbol();
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  function refreshPending() {
    const [id, { callback }] = [...timers].find(([, task]) => task.ms === 150);
    timers.delete(id);
    callback();
  }
  try {
    await flush();
    transport.status("SUBSCRIBED");
    finishFirstProbe({ version: "depot:1", day: state.today });
    await flush();
    refreshPending();
    assert.equal(state.syncVersion, "depot:2");

    transport.change({ version: "depot:3" });
    refreshPending();
    assert.equal(state.syncVersion, "depot:3");

    remote = "depot:4";
    transport.status("CHANNEL_ERROR");
    await flush();
    refreshPending();
    assert.equal(state.syncVersion, "depot:4");
    assert.equal(closed, 1);

    documentImpl.visibilityState = "hidden";
    documentImpl.dispatchEvent(new Event("visibilitychange"));
    transport.change({ version: "depot:5" });
    assert.equal(timers.size, 0);
    assert.deepEqual(calls, [
      "/sync-version",
      "/realtime-session",
      "/sync-version",
      "/sync-version",
    ]);
  } finally {
    stop();
  }
});
