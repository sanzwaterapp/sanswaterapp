import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { duration, sortDisplayOrders } from "../src/api.js";
import { deliveryCategory } from "../src/delivery-performance.js";

const received = "2026-11-16T01:00:00.000Z";
const departed = "2026-11-16T01:20:00.000Z";
const finished = "2026-11-16T03:00:00.000Z";
const photo =
  "data:image/png;base64," +
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(16, 1),
  ]).toString("base64");

test("chip durasi dan urutan tetap memakai mulai Antar setelah Selesai", () => {
  const order = {
    id: "a",
    kind: "delivery",
    received_at: received,
    first_departure_at: departed,
  };
  for (const status of ["delivery", "done", "failed", "partial"]) {
    assert.equal(
      duration(
        { ...order, status, completed_at: finished },
        Date.parse("2026-11-18"),
      ),
      20,
    );
  }
  assert.equal(
    deliveryCategory(duration({ ...order, completed_at: finished }) * 60),
    "fast",
  );
  assert.equal(
    duration({ kind: "delivery", received_at: received }, Date.parse(departed)),
    20,
  );
  assert.equal(
    duration({ ...order, kind: "counter", completed_at: finished }),
    0,
  );
  const longer = {
    ...order,
    id: "b",
    status: "done",
    first_departure_at: "2026-11-16T01:40:00.000Z",
    completed_at: "2026-11-16T01:50:00.000Z",
  };
  assert.deepEqual(
    sortDisplayOrders([
      { ...order, status: "done", completed_at: finished },
      longer,
    ]).map((row) => row.id),
    ["b", "a"],
  );
});

async function fixture(t) {
  let now = received;
  const app = createApp({
    dbPath: ":memory:",
    clock: () => now,
    auth: { provider: "local" },
    photoStorage: { driver: "local", cache: false },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  function client() {
    let cookie = "";
    return async (path, body) => {
      const response = await fetch(
        `http://127.0.0.1:${app.server.address().port}/api${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            cookie,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      if (response.headers.has("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      const result = await response.json();
      assert.equal(response.status, 200, path + ": " + JSON.stringify(result));
      return result;
    };
  }
  const owner = client();
  await owner("/setup", {
    name: "Owner QA",
    username: "owner",
    password: "Duration-QA-only",
    depotName: "Duration QA",
  });
  const category = await owner("/categories", { name: "Air" });
  const product = await owner("/products", {
    name: "RO",
    categoryId: category.id,
    tracked: false,
    modes: [{ name: "Isi ulang", price: 5000 }],
  });
  const customer = await owner("/customers", {
    code: "D1",
    name: "Pelanggan QA",
    whatsapp: "08000000001",
  });
  const state = await owner("/state");
  const line = {
    productId: product.id,
    modeId: state.products[0].modes[0].id,
    qty: 1,
    price: 5000,
  };
  await owner("/staff", {
    name: "Kurir QA",
    username: "courier",
    password: "Duration-QA-only",
    permissions: ["orders", "trips"],
  });
  const courier = client();
  await courier("/login", {
    username: "courier",
    password: "Duration-QA-only",
  });
  return {
    app,
    owner,
    courier,
    line,
    advance: (time) => {
      now = time;
    },
    order: () =>
      owner("/orders", {
        customerId: customer.id,
        source: "WhatsApp",
        receivedTime: "08:00",
        items: [line],
      }),
    trip: (orderId) => courier("/trips", { orderIds: [orderId], photo }),
    complete: (orderId, tripId) =>
      courier(`/trips/${tripId}/orders/${orderId}/result`, {
        outcome: "done",
        items: [line],
        paid: 0,
        shipping: 0,
      }),
  };
}

test("semua endpoint riwayat menghentikan durasi saat Antar, waktu selesai tetap utuh", async (t) => {
  const f = await fixture(t);
  const order = await f.order();
  f.advance(departed);
  const trip = await f.trip(order.id);
  assert.equal(
    duration(
      (await f.owner("/state")).orders.find((row) => row.id === order.id),
    ),
    20,
  );
  f.advance(finished);
  await f.complete(order.id, trip.id);
  const done = (await f.owner("/state")).orders.find(
    (row) => row.id === order.id,
  );
  assert.equal(done.completed_at, finished);
  assert.equal(done.first_departure_at, departed);
  assert.equal(duration(done), 20);
  const full = await f.owner("/reports?from=2026-11-16&to=2026-11-16");
  const dashboard = await f.owner(
    "/reports?from=2026-11-16&to=2026-11-16&view=dashboard",
  );
  const staff = await f.courier("/home-summary?day=2026-11-16");
  const own = await f.courier("/delivery-performance");
  for (const rows of [
    full.deliveryPerformance,
    dashboard.deliveryPerformance,
    staff.deliveryPerformance,
    own,
  ]) {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seconds, 1200);
    assert.equal(rows[0].first_departure_at, departed);
    assert.equal(rows[0].completed_at, finished);
    assert.equal(deliveryCategory(rows[0].seconds), "fast");
  }
  const otherCourier = await f.owner("/delivery-performance");
  assert.deepEqual(otherCourier, []);
  const paged = await f.owner(
    "/orders?filter=done&from=2026-11-16&to=2026-11-16",
  );
  assert.equal(paged.orders[0].queue_minutes, 20);
  assert.equal(duration(paged.orders[0]), 20);
});

test("antar ulang melewati tengah malam dan riwayat lama tetap memakai keberangkatan pertama", async (t) => {
  const f = await fixture(t);
  const order = await f.order();
  f.advance(departed);
  const first = await f.trip(order.id);
  f.advance(finished);
  await f.courier(`/trips/${first.id}/orders/${order.id}/result`, {
    outcome: "failed",
    reason: "Rumah kosong",
  });
  f.advance("2026-11-16T17:10:00.000Z");
  const retry = await f.trip(order.id);
  f.advance("2026-11-16T17:40:00.000Z");
  await f.complete(order.id, retry.id);
  for (const legacy of [false, true]) {
    if (legacy)
      f.app.db
        .prepare("UPDATE orders SET first_departure_at=NULL WHERE id=?")
        .run(order.id);
    const report = await f.owner("/reports?from=2026-11-17&to=2026-11-17");
    assert.equal(report.deliveryPerformance.length, 1);
    assert.equal(report.deliveryPerformance[0].seconds, 1200);
    assert.equal(report.deliveryPerformance[0].first_departure_at, departed);
    assert.equal(
      report.deliveryPerformance[0].completed_at,
      "2026-11-16T17:40:00.000Z",
    );
    const rows = (
      await f.owner("/orders?filter=done&from=2026-11-16&to=2026-11-17")
    ).orders;
    assert.equal(rows[0].queue_minutes, 20);
    assert.equal(duration(rows[0]), 20);
  }
  assert.deepEqual(
    (await f.owner("/reports?from=2026-11-16&to=2026-11-16"))
      .deliveryPerformance,
    [],
  );
});
