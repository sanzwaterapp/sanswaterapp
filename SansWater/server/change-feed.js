import { coversVersion } from "../src/sync-version.js";

// One scalar primary check per backend, shared by all visible clients. Business
// reads/writes still use the authoritative transaction; this feed carries no rows.
export function createChangeFeed({
  probe,
  synchronize,
  day,
  interval = 15000,
  heartbeat = 25000,
  maxClients = 128,
  maxAge = 0,
}) {
  const clients = new Set();
  let version = null,
    timer = null,
    checking = false,
    closed = false,
    offline = false;
  const payload = () => ({ version, day: day() });
  function stopIfIdle() {
    if (!clients.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  function remove(client) {
    clearTimeout(client.expiry);
    clients.delete(client);
    stopIfIdle();
  }
  function send(client, event, data) {
    if (client.res.destroyed || client.res.writableEnded) {
      remove(client);
      return;
    }
    try {
      if (!client.valid()) {
        client.res.write("event: auth\ndata: {}\n\n");
        client.res.end();
        remove(client);
        return;
      }
      const frame =
        "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
      if (client.res.writableLength > 8192 || !client.res.write(frame)) {
        client.res.end();
        remove(client);
      }
      client.lastSent = Date.now();
    } catch {
      // A dead subscriber must never turn a committed save into an error.
      client.res.end();
      remove(client);
    }
  }
  function broadcast(event, data) {
    for (const client of [...clients]) send(client, event, data);
  }
  function notify(next) {
    if (!next || next === version || (version && coversVersion(version, next)))
      return;
    version = next;
    broadcast("change", payload());
  }
  async function check() {
    if (closed || checking || !clients.size) return;
    checking = true;
    try {
      if (probe) {
        const remote = await probe();
        if (!coversVersion(version, remote)) notify(await synchronize());
      }
      if (offline) {
        offline = false;
        broadcast("available", payload());
      }
      const now = Date.now();
      for (const client of [...clients])
        if (now - client.lastSent >= heartbeat)
          send(client, "pulse", payload());
    } catch {
      if (!offline) {
        offline = true;
        broadcast("unavailable", {});
      }
    } finally {
      checking = false;
    }
  }
  return {
    notify,
    check,
    get size() {
      return clients.size;
    },
    add(req, res, { headers, valid, currentVersion }) {
      if (closed || clients.size >= maxClients)
        throw Object.assign(
          new Error("Koneksi pembaruan sedang penuh. Coba lagi sesaat."),
          { status: 503 },
        );
      notify(currentVersion);
      res.writeHead(200, {
        ...headers,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write("retry: 10000\n\n");
      const client = { res, valid, lastSent: Date.now() };
      if (maxAge > 0) {
        client.expiry = setTimeout(() => {
          send(client, "renew", payload());
          res.end();
          remove(client);
        }, maxAge);
        client.expiry.unref?.();
      }
      clients.add(client);
      res.on("close", () => remove(client));
      send(client, "ready", payload());
      if (!timer && clients.size) {
        timer = setInterval(check, interval);
        timer.unref?.();
      }
    },
    close() {
      closed = true;
      clearInterval(timer);
      timer = null;
      for (const client of clients) {
        clearTimeout(client.expiry);
        client.res.end();
      }
      clients.clear();
    },
  };
}
