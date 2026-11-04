import { api } from "./api.js";
import { coversVersion } from "./sync-version.js";

// This is a signal channel. Business data still goes through authenticated APIs.
export function connectLiveUpdates({
  getState,
  refresh,
  onStatus = () => {},
  onUnauthorized,
  EventSourceImpl = globalThis.EventSource,
  documentImpl = document,
  windowImpl = window,
  probe = () => api("/sync-version"),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let stopped = false,
    source = null,
    retry = null,
    scheduled = null,
    requested = null,
    delay = 5000;
  const visible = () => documentImpl.visibilityState !== "hidden";
  function disconnect() {
    source?.close();
    source = null;
    clearTimer(retry);
    retry = null;
  }
  function queue(version) {
    if (stopped || !visible()) return;
    if (!requested || !coversVersion(requested, version)) requested = version;
    if (scheduled) return;
    scheduled = setTimer(() => {
      scheduled = null;
      const minimum = requested;
      requested = null;
      Promise.resolve(refresh(minimum)).catch(() => onStatus("offline"));
    }, 150);
  }
  function notice(value, force = false) {
    if (stopped || !visible()) return;
    const current = getState();
    if (!current) return;
    onStatus("connected");
    if (
      force ||
      !coversVersion(current.syncVersion, value.version) ||
      current.today !== value.day
    )
      queue(value.version);
  }
  async function lightweightProbe() {
    try {
      notice(await probe());
    } catch (error) {
      if (!stopped) {
        if (error.status === 401) onUnauthorized?.();
        else onStatus("offline");
      }
    }
  }
  function connect() {
    if (stopped || !visible()) return;
    disconnect();
    if (!EventSourceImpl) {
      lightweightProbe();
      retry = setTimer(connect, 60000);
      return;
    }
    const current = new EventSourceImpl("/api/events");
    source = current;
    function signal(event) {
      if (source !== current || stopped) return;
      try {
        const value = JSON.parse(event.data);
        if (typeof value.version !== "string" || typeof value.day !== "string")
          return;
        delay = 5000;
        notice(value, event.type === "available");
      } catch {
        /* Ignore incomplete signals. */
      }
    }
    for (const name of ["ready", "change", "pulse", "available"])
      current.addEventListener(name, signal);
    current.addEventListener("unavailable", () => {
      if (source === current) onStatus("offline");
    });
    current.addEventListener("auth", () => {
      if (source === current) {
        disconnect();
        onUnauthorized?.();
      }
    });
    current.addEventListener("renew", () => {
      if (source !== current || stopped) return;
      disconnect();
      retry = setTimer(connect, 1000);
    });
    current.onerror = () => {
      if (source !== current || stopped) return;
      disconnect();
      onStatus("reconnecting");
      lightweightProbe();
      retry = setTimer(connect, delay);
      delay = Math.min(60000, delay * 2);
    };
  }
  const visibility = () => {
    if (!visible()) {
      disconnect();
      clearTimer(scheduled);
      scheduled = null;
      requested = null;
    } else connect();
  };
  const online = () => {
    delay = 5000;
    connect();
  };
  documentImpl.addEventListener("visibilitychange", visibility);
  windowImpl.addEventListener("online", online);
  connect();
  return () => {
    stopped = true;
    disconnect();
    clearTimer(scheduled);
    documentImpl.removeEventListener("visibilitychange", visibility);
    windowImpl.removeEventListener("online", online);
  };
}
