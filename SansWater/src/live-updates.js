import { api } from "./api.js";
import { coversVersion } from "./sync-version.js";

async function subscribeToChanges(session, onChange, onStatus) {
  const { RealtimeClient } = await import("@supabase/realtime-js");
  const { url, publicKey, topic, token } = session;
  const endpoint = new URL("/realtime/v1", url);
  endpoint.protocol = "wss:";
  const client = new RealtimeClient(endpoint.href, {
    params: { apikey: publicKey },
  });
  await client.setAuth(token);
  client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "revision" }, ({ payload }) => onChange(payload))
    .subscribe(onStatus);
  return () => {
    void client.disconnect().catch(() => {});
    void client.removeAllChannels().catch(() => {});
  };
}

export function connectLiveUpdates({
  getState,
  refresh,
  onStatus = () => {},
  onUnauthorized,
  documentImpl = document,
  windowImpl = window,
  request = api,
  subscribe = subscribeToChanges,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active;

  function stop() {
    const scope = active;
    active = null;
    if (!scope) return;
    scope.controller.abort();
    clearTimer(scope.poll);
    clearTimer(scope.retry);
    clearTimer(scope.refresh);
    scope.channel?.close?.();
  }

  function start() {
    stop();
    if (documentImpl.visibilityState === "hidden") return;
    const scope = {
      controller: new AbortController(),
      retryDelay: 30000,
      connected: false,
    };
    active = scope;
    const current = () => active === scope;
    async function get(path) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const stopSignal = scope.controller.signal;
      stopSignal.addEventListener("abort", abort, { once: true });
      const deadline = setTimer(abort, 12000);
      try {
        return await request(path, { signal: controller.signal });
      } finally {
        clearTimer(deadline);
        stopSignal.removeEventListener("abort", abort);
      }
    }

    function reportError(error) {
      if (!current()) return;
      if (error.status === 401) {
        stop();
        onUnauthorized?.();
      } else onStatus("offline");
    }

    function notice({ version, day } = {}) {
      const state = getState();
      if (!current() || !state || typeof version !== "string") return;
      onStatus("connected");
      if (
        coversVersion(state.syncVersion, version) &&
        (!day || day === state.today)
      )
        return;
      if (!coversVersion(scope.pending, version)) scope.pending = version;
      if (scope.refresh == null)
        scope.refresh = setTimer(() => {
          scope.refresh = null;
          const minimum = scope.pending;
          scope.pending = null;
          if (current()) Promise.resolve(refresh(minimum)).catch(reportError);
        }, 150);
    }

    function scheduleProbe() {
      clearTimer(scope.poll);
      if (current()) {
        const delay = scope.connected ? 120000 : 30000;
        scope.poll = setTimer(check, delay + Math.random() * 5000);
      }
    }

    async function check() {
      clearTimer(scope.poll);
      if (!current()) return;
      if (scope.checking) {
        scope.checkAgain = true;
        return;
      }
      scope.checking = true;
      try {
        notice(await get("/sync-version"));
      } catch (error) {
        reportError(error);
      } finally {
        scope.checking = false;
        if (scope.checkAgain && current()) {
          scope.checkAgain = false;
          void check();
        } else scheduleProbe();
      }
    }

    async function connect() {
      if (!current()) return;
      const channel = {};
      scope.channel = channel;
      const isCurrent = () => current() && scope.channel === channel;

      function reconnect(delay) {
        if (!isCurrent()) return;
        scope.channel = null;
        scope.connected = false;
        channel.close?.();
        clearTimer(scope.retry);
        void check();
        scope.retry = setTimer(connect, delay);
      }

      function retry() {
        reconnect(scope.retryDelay);
        scope.retryDelay = Math.min(scope.retryDelay * 2, 300000);
      }

      try {
        const session = await get("/realtime-session");
        if (!isCurrent() || !session) return;
        // Refresh credentials before expiry and check for changes after the next join.
        scope.retry = setTimer(
          () => reconnect(0),
          (session.validFor - 60) * 1000,
        );
        const close = await subscribe(
          session,
          (event) => {
            if (isCurrent()) notice(event);
          },
          (status) => {
            if (!isCurrent()) return;
            if (status === "SUBSCRIBED") {
              scope.connected = true;
              scope.retryDelay = 30000;
              void check();
            } else retry();
          },
        );
        if (isCurrent()) channel.close = close;
        else close();
      } catch (error) {
        if (!isCurrent()) return;
        if (error.status === 401) reportError(error);
        else retry();
      }
    }

    void check();
    if (getState()?.realtimeEnabled) void connect();
  }

  documentImpl.addEventListener("visibilitychange", start);
  windowImpl.addEventListener("online", start);
  start();
  return () => {
    stop();
    documentImpl.removeEventListener("visibilitychange", start);
    windowImpl.removeEventListener("online", start);
  };
}
