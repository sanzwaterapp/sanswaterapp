import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApp } from "../server/app.js";

test("expense totals span all pages and own payroll allows older periods", async (t) => {
  const today = "2026-11-20";
  const app = createApp({
    dbPath: ":memory:",
    auth: { provider: "local" },
    clock: () => `${today}T05:00:00.000Z`,
    photoStorage: { driver: "local", cache: false },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  function client() {
    let cookie = "";
    return async (path, body, status = 200) => {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          cookie,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: body && JSON.stringify(body),
      });
      if (response.headers.has("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      const data = await response.json();
      assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
      return data;
    };
  }
  const password = "Expenses-Payroll-QA-only";
  const owner = client();
  const { user } = await owner("/setup", {
    name: "Owner QA",
    username: "owner",
    password,
    depotName: "Depot QA",
  });
  const expense = {
    kind: "expense",
    day: today,
    fromFund: "operating",
    fromMethod: "Tunai",
    amount: 1000,
  };
  const { id } = await owner("/cash-entries", {
    ...expense,
    expenseGroup: "Produk",
    note: "Isi ulang stok",
  });
  await owner(
    "/cash-entries",
    { ...expense, expenseGroup: "BBM", note: "Bensin" },
    400,
  );
  await owner("/cash-entries", { ...expense, category: "BBM", amount: 500 });
  await owner("/cash-entries", {
    ...expense,
    fromFund: "gas",
    expenseGroup: "Perawatan",
    note: "Perbaikan alat",
    amount: 3000,
  });
  const canceled = await owner("/cash-entries", {
    ...expense,
    expenseGroup: "Produk",
    note: "Batal beli",
  });
  await owner(`/cash-entries/${canceled.id}/void`, {
    version: 1,
    reason: "Batal",
  });
  const add = app.db.prepare(`INSERT INTO cash_entries
    (id,kind,day,from_fund,from_method,amount,category,note,actor_id,created_at)
    VALUES (?,'expense',?,'operating','Tunai',1000,'Produk','Barang',?,?)`);
  for (let i = 0; i < 30; i++)
    add.run(randomUUID(), today, user.id, `${today}T05:01:00Z`);

  const ledger = "/cash-ledger?kind=expense&fund=operating";
  const result = await owner(`${ledger}&category=Produk&offset=30`);
  assert.equal(result.total, 32);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.find((row) => row.id === id).note, "Isi ulang stok");
  assert.deepEqual(result.expenseSummary, {
    byCategory: { Produk: 31000, uncategorized: 500 },
    total: 31500,
  });
  assert.equal(
    (await owner(`${ledger}&category=uncategorized`)).rows[0].category,
    "BBM",
  );
  await owner(`${ledger}&category=invalid`, undefined, 400);
  assert.equal((await owner("/reports?view=summary")).cashFlow.outgoing, 34500);

  const staff = client();
  const { id: staffId } = await owner("/staff", {
    name: "Staff QA",
    username: "staff",
    password,
    role: "staff",
    permissions: [],
  });
  await staff("/login", { username: "staff", password });
  for (const from of ["2026-11-14", "2026-11-01", "2026-10-15"]) {
    const payroll = await staff(`/payroll?from=${from}&to=${today}`);
    assert.equal(payroll.from, from);
    assert.equal(payroll.ownOnly, true);
    assert.equal(payroll.readOnly, true);
    assert.deepEqual(
      payroll.actors.map((actor) => actor.id),
      [staffId],
    );
    assert.deepEqual(
      payroll.rows.map((row) => row.id),
      [staffId],
    );
  }
  await staff(
    `/payroll?from=2026-11-01&to=${today}&actor=${user.id}`,
    undefined,
    403,
  );
  await staff("/payroll?from=2026-11-01&to=2026-11-21", undefined, 400);
});
