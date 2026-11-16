import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";

test("laporan kas membatasi baris, saldo, dan rincian ke akun sendiri kecuali Owner", async (t) => {
  const day = "2026-11-17";
  const time = `${day}T04:00:00.000Z`;
  const app = createApp({
    dbPath: ":memory:",
    clock: () => time,
    auth: { provider: "local" },
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
      const nextCookie = response.headers.get("set-cookie");
      if (nextCookie) cookie = nextCookie.split(";")[0];
      const result = await response.json();
      assert.equal(
        response.status,
        status,
        `${path}: ${JSON.stringify(result)}`,
      );
      return result;
    };
  }

  const password = "CashScope-QA-only";
  const owner = client();
  await owner("/setup", {
    name: "Owner QA",
    username: "owner",
    password,
    depotName: "Cash Scope QA",
  });
  const ownerId = (await owner("/session")).user.id;
  async function employee(role) {
    const { id } = await owner("/staff", {
      name: `QA ${role}`,
      username: role,
      password,
      role,
      permissions: [],
    });
    const request = client();
    await request("/login", { username: role, password });
    return { id, request };
  }
  const manager = await employee("manager");
  const staff = await employee("staff");
  const driver = await employee("driver");

  const insertPayment = app.db.prepare(
    "INSERT INTO payments (id,amount,method,scope,created_at,actor_id) VALUES (?,?,'Tunai','[]',?,?)",
  );
  const insertExpense = app.db.prepare(
    "INSERT INTO cash_entries (id,kind,day,from_fund,from_method,amount,category,note,actor_id,created_at) VALUES (?,'expense',?,'operating','Tunai',?,'Uji','',?,?)",
  );
  for (const [actor, income, expense] of [
    [ownerId, 90000, 9000],
    [manager.id, 23000, 3000],
    [staff.id, 13000, 2000],
  ]) {
    insertPayment.run(randomUUID(), income, time, actor);
    insertExpense.run(randomUUID(), day, expense, actor, time);
  }

  const query = `from=${day}&to=${day}`;
  const cashPath = `/transactions/cash?${query}`;
  for (const [account, income, expense] of [
    [manager, 23000, 3000],
    [staff, 13000, 2000],
    [driver, 0, 0],
  ]) {
    const { staffCash, cashFlow } = await account.request(
      `${cashPath}&actor=${ownerId}`,
    );
    assert.deepEqual(
      staffCash.map((row) => row.key),
      [account.id],
    );
    assert.equal(cashFlow.incoming, income);
    assert.equal(cashFlow.outgoing, expense);
    assert.equal(cashFlow.net, income - expense);
  }
  const all = await owner(cashPath);
  assert.deepEqual(
    new Set(all.staffCash.map((row) => row.key)),
    new Set([ownerId, manager.id, staff.id, driver.id]),
  );
  assert.equal(all.cashFlow.net, 112000);

  const managerReport = await manager.request(`/reports?${query}&view=summary`);
  assert.deepEqual(
    managerReport.staffCash.map((row) => row.key),
    [manager.id],
  );
  assert.equal(managerReport.cashFlow.net, 20000);
  assert.equal("cashHolders" in managerReport, false);
  const detail = `/report-cashflow?${query}&kind=expense`;
  for (const filters of ["", "&fund=operating", `&actor=${manager.id}`]) {
    const own = await manager.request(detail + filters);
    assert.equal(own.total, 1);
    assert.deepEqual(
      own.rows.map((row) => [row.actor_id, row.amount]),
      [[manager.id, 3000]],
    );
  }
  await manager.request(`${detail}&actor=${ownerId}`, undefined, 403);
  assert.equal((await owner(detail)).total, 3);
  assert.equal(
    (await owner(`${detail}&actor=${staff.id}`)).rows[0].amount,
    2000,
  );
});
