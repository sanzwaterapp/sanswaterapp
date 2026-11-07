import { fail, integer } from "./domain.js";

// Each level reads aggregates or one bounded page; invoice JSON is fetched only on detail open.
export function registerReportRoutes(route, d) {
  registerPayroll(route, d);
  registerExplorer(route, d, { prefix: "/api/report-", permission: "reports" });
  route("GET", "/api/transactions/cash", "login", (ctx) =>
    d.transactionCash(ctx.query),
  );
  registerExplorer(route, d, {
    prefix: "/api/transactions/",
    permission: "login",
    byCounterAccount: true,
  });
}

function registerPayroll(route, d) {
  const components = [
    "roShift1",
    "mineralShift1",
    "roShift2",
    "mineralShift2",
    "delivery",
  ];
  const shiftNumberSql = `COALESCE(json_extract(w.comparison_snapshot,'$.shiftNumber'),
    (SELECT COUNT(*) FROM water_checks earlier
      WHERE json_extract(earlier.comparison_snapshot,'$.scope')='shift'
        AND substr(datetime(earlier.created_at,'+7 hours'),1,10)=substr(datetime(w.created_at,'+7 hours'),1,10)
        AND earlier.rowid<=w.rowid))`;
  const activitySql = `WITH assigned AS (
    SELECT i.*,t.courier_id,
      (SELECT w.id FROM water_checks w
        LEFT JOIN water_checks previous ON previous.id=w.previous_id
        WHERE json_extract(w.comparison_snapshot,'$.scope')='shift'
          AND i.recorded_at>=w.start_at AND i.recorded_at<=w.created_at
          AND (i.recorded_at>w.start_at OR i.rowid>COALESCE(previous.invoice_cursor,0))
          AND i.rowid<=w.invoice_cursor
        ORDER BY w.rowid LIMIT 1) shift_id
    FROM invoices i JOIN trips t ON t.id=i.trip_id
  ), meter_readings AS (
    SELECT w.actor_id,w.id,
      COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(w.created_at,'+7 hours'),1,10)) day,
      w.id shift_id,${shiftNumberSql} shift_number,w.created_at closed_at,
      COALESCE((SELECT SUM(json_extract(r.value,'$.liters')) FROM json_each(w.readings) r WHERE json_extract(r.value,'$.meterId')='ro1'),0) ro1,
      COALESCE((SELECT SUM(json_extract(r.value,'$.liters')) FROM json_each(w.readings) r WHERE json_extract(r.value,'$.meterId')='ro2'),0) ro2,
      COALESCE((SELECT SUM(json_extract(r.value,'$.liters')) FROM json_each(w.readings) r WHERE json_extract(r.value,'$.meterId')='mineral'),0) mineral,
      COALESCE(json_extract(a.value,'$.ro'),w.actor_id) ro_actor,
      COALESCE(json_extract(a.value,'$.mineral'),w.actor_id) mineral_actor
    FROM water_checks w LEFT JOIN settings a ON a.key='payroll.assignment:'||w.id
    WHERE json_extract(w.comparison_snapshot,'$.scope')='shift'
  ), raw_activities AS (
    SELECT ro_actor actor_id,day,shift_id,shift_number,closed_at,ro1,ro2,0 mineral,
      0 delivery,0 delivery_orders,0 missing_capacity FROM meter_readings
    UNION ALL
    SELECT mineral_actor,day,shift_id,shift_number,closed_at,0,0,mineral,
      0,0,0 FROM meter_readings
    UNION ALL
    SELECT i.courier_id,
      COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(i.recorded_at,'+7 hours'),1,10)) day,
      w.id,${shiftNumberSql},w.created_at,0,0,0,
      COALESCE((SELECT SUM(COALESCE(json_extract(line.value,'$.capacityLiters'),0)*json_extract(line.value,'$.qty')) FROM json_each(i.items) line),0),
      1,EXISTS(SELECT 1 FROM json_each(i.items) line WHERE json_type(line.value,'$.capacityLiters') IS NULL)
    FROM assigned i LEFT JOIN water_checks w ON w.id=i.shift_id
  ), activities AS (
    SELECT actor_id,day,shift_id,shift_number,closed_at,
      CASE WHEN shift_number=1 THEN ro1+ro2 ELSE 0 END roShift1,
      CASE WHEN shift_number=1 THEN mineral ELSE 0 END mineralShift1,
      CASE WHEN shift_number=2 THEN ro1+ro2 ELSE 0 END roShift2,
      CASE WHEN shift_number=2 THEN mineral ELSE 0 END mineralShift2,
      delivery,delivery_orders,missing_capacity
    FROM raw_activities
  ) `;
  const totalsSql = components
    .map((key) => "COALESCE(SUM(" + key + "),0) " + key)
    .join(",");
  const rounded = (number) => Math.round(number * 1e6) / 1e6;
  function ratesFor(actor) {
    const row = d.get(
      "SELECT value FROM settings WHERE key=?",
      "payroll.rate:" + actor,
    );
    const stored = row ? JSON.parse(row.value) : {};
    return {
      version: stored.version || 0,
      ...Object.fromEntries(components.map((key) => [key, stored[key] || 0])),
    };
  }
  function measures(row, rates) {
    const amounts = Object.fromEntries(
      components.map((key) => [
        key,
        {
          liters: rounded(row[key]),
          gallons: rounded(row[key] / 19),
          rate: rates[key],
          amount: Math.round((row[key] / 19) * rates[key]),
        },
      ]),
    );
    const amount = Object.values(amounts).reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    if (!Number.isSafeInteger(amount))
      fail(
        "Nilai payroll terlalu besar. Persempit periode atau periksa tarif.",
      );
    return {
      components: amounts,
      amount,
      deliveryOrders: row.delivery_orders || 0,
      missingCapacity: row.missing_capacity || 0,
    };
  }
  function scope(query) {
    const period = d.period(query);
    // Reject normalized impossible dates as well as reversed ranges.
    for (const day of [period.from, period.to])
      if (new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day)
        fail("Tanggal payroll belum benar.");
    return period;
  }
  function variableConfig() {
    const row = d.get(
      "SELECT value FROM settings WHERE key='payroll.variables'",
    );
    const saved = row ? JSON.parse(row.value) : null;
    return saved
      ? {
          ...saved,
          drivers: Object.fromEntries(
            Object.entries(saved.drivers || {}).map(([id, item]) => [
              id,
              { ...item, actor: id },
            ]),
          ),
        }
      : {
          version: 0,
          meters: Object.fromEntries(
            components
              .filter((key) => key !== "delivery")
              .map((key) => [key, { actor: "", rate: 0 }]),
          ),
          drivers: {},
        };
  }
  route("PATCH", "/api/payroll/config", "reports", (ctx) => {
    const previous = variableConfig();
    if (ctx.body.version !== previous.version)
      fail("Pengaturan sudah berubah. Muat ulang Payroll.", 409);
    function validate(item) {
      if (!item || typeof item.actor !== "string")
        fail("Penanggung jawab belum benar.");
      if (item.actor) d.find("users", item.actor);
      const rate = integer(item.rate, "Tarif per galon", 0, 10000000);
      if (rate > 0 && !item.actor)
        fail("Pilih penanggung jawab untuk tarif ini.");
      return { actor: item.actor, rate };
    }
    const meters = Object.fromEntries(
      components
        .filter((key) => key !== "delivery")
        .map((key) => [key, validate(ctx.body.meters?.[key])]),
    );
    if (
      !ctx.body.drivers ||
      typeof ctx.body.drivers !== "object" ||
      Array.isArray(ctx.body.drivers)
    )
      fail("Tarif antar belum benar.");
    const drivers = Object.fromEntries(
      Object.entries(ctx.body.drivers).map(([id, item]) => {
        d.find("users", id);
        return [id, validate({ ...item, actor: id })];
      }),
    );
    const next = { version: previous.version + 1, meters, drivers };
    d.run(
      "INSERT INTO settings(key,value) VALUES('payroll.variables',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(next),
    );
    d.audit(ctx.user, "payroll.variables", "payroll", previous, next);
    return next;
  });
  route("PATCH", "/api/payroll/config/:id/clear", "reports", (ctx) => {
    d.find("users", ctx.params.id);
    const previous = variableConfig();
    if (ctx.body.version !== previous.version)
      fail("Pengaturan sudah berubah. Muat ulang Payroll.", 409);
    const next = {
      ...previous,
      version: previous.version + 1,
      meters: Object.fromEntries(
        Object.entries(previous.meters).map(([key, item]) => [
          key,
          item.actor === ctx.params.id ? { actor: "", rate: 0 } : item,
        ]),
      ),
      drivers: Object.fromEntries(
        Object.entries(previous.drivers).filter(([id]) => id !== ctx.params.id),
      ),
    };
    d.run(
      "INSERT INTO settings(key,value) VALUES('payroll.variables',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(next),
    );
    d.audit(ctx.user, "payroll.account.clear", ctx.params.id, previous, next);
    return next;
  });
  function assignmentFor(shift) {
    const row = d.get(
      "SELECT value FROM settings WHERE key=?",
      "payroll.assignment:" + shift.id,
    );
    return row
      ? JSON.parse(row.value)
      : { version: 0, ro: shift.actor_id, mineral: shift.actor_id };
  }
  route("GET", "/api/payroll/assignments", "reports", (ctx) => {
    const period = scope(ctx.query);
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman",
      0,
      10000000,
    );
    const where =
      " WHERE json_extract(w.comparison_snapshot,'$.scope')='shift' AND COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(w.created_at,'+7 hours'),1,10)) BETWEEN ? AND ?";
    const args = [period.from, period.to];
    const total = d.get(
      "SELECT COUNT(*) total FROM water_checks w" + where,
      ...args,
    ).total;
    const rows = d
      .all(
        "SELECT w.id,w.actor_id,w.created_at,COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(w.created_at,'+7 hours'),1,10)) day," +
          shiftNumberSql +
          " shift_number FROM water_checks w" +
          where +
          " ORDER BY day DESC,shift_number DESC,w.rowid DESC LIMIT 30 OFFSET ?",
        ...args,
        offset,
      )
      .map((row) => ({
        id: row.id,
        day: row.day,
        shiftNumber: row.shift_number,
        assignment: assignmentFor(row),
      }));
    return { rows, offset, total, hasMore: offset + rows.length < total };
  });
  route("PATCH", "/api/payroll/assignments/:id", "reports", (ctx) => {
    const shift = d.find("water_checks", ctx.params.id);
    if (JSON.parse(shift.comparison_snapshot).scope !== "shift")
      fail("Catatan bukan penutupan shift.");
    const previous = assignmentFor(shift);
    if (ctx.body.version !== previous.version)
      fail("Petugas sudah diubah. Muat ulang Payroll.", 409);
    for (const key of ["ro", "mineral"]) {
      const user = d.find("users", ctx.body[key]);
      if (!user.active && previous[key] !== user.id)
        fail("Pilih akun yang aktif.");
    }
    const shiftNumber = d.get(
      "SELECT " + shiftNumberSql + " number FROM water_checks w WHERE w.id=?",
      shift.id,
    ).number;
    const changedRates = new Map();
    for (const key of ["ro", "mineral"]) {
      if (!ctx.body[key + "Rate"]) continue;
      const rate = ctx.body[key + "Rate"];
      const actor = ctx.body[key];
      const before = ratesFor(actor);
      if (rate.version !== before.version)
        fail("Tarif sudah diubah. Muat ulang Payroll.", 409);
      const component =
        (key === "ro" ? "roShift" : "mineralShift") + shiftNumber;
      if (!components.includes(component)) fail("Nomor shift belum didukung.");
      const pending = changedRates.get(actor) || {
        before,
        next: { ...before, version: before.version + 1 },
      };
      pending.next[component] = integer(
        rate.value,
        "Tarif per galon",
        0,
        10000000,
      );
      changedRates.set(actor, pending);
    }
    for (const [actor, { before, next }] of changedRates) {
      d.run(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        "payroll.rate:" + actor,
        JSON.stringify(next),
      );
      d.audit(ctx.user, "payroll.rates", actor, before, next);
    }
    const next = {
      version: previous.version + 1,
      ro: ctx.body.ro,
      mineral: ctx.body.mineral,
    };
    d.run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "payroll.assignment:" + shift.id,
      JSON.stringify(next),
    );
    d.audit(ctx.user, "payroll.assignment", shift.id, previous, next);
    return next;
  });
  route("GET", "/api/payroll", "reports", (ctx) => {
    const period = scope(ctx.query);
    const actors = d.all("SELECT id,name,active FROM users ORDER BY name,id");
    const actor = ctx.query.get("actor") || "";
    if (actor && !actors.some((row) => row.id === actor))
      fail("Akun payroll tidak ditemukan.");
    const activity = d.all(
      activitySql +
        "SELECT actor_id," +
        totalsSql +
        ",SUM(delivery_orders) delivery_orders,SUM(missing_capacity) missing_capacity,COUNT(DISTINCT shift_id) shift_count FROM activities WHERE day>=? AND day<=? GROUP BY actor_id",
      period.from,
      period.to,
    );
    const summary = Object.fromEntries(
      components.map((key) => [key, { liters: 0, gallons: 0, amount: 0 }]),
    );
    const rows = actors
      .filter(
        (user) =>
          (!actor || user.id === actor) &&
          (user.active || activity.some((row) => row.actor_id === user.id)),
      )
      .map((user) => {
        const totals =
          activity.find((row) => row.actor_id === user.id) ||
          Object.fromEntries(components.map((key) => [key, 0]));
        const rates = ratesFor(user.id);
        const measured = measures(totals, rates);
        for (const key of components) {
          summary[key].liters += measured.components[key].liters;
          summary[key].amount += measured.components[key].amount;
        }
        return {
          id: user.id,
          name: user.name,
          active: !!user.active,
          rates,
          shiftCount: totals.shift_count || 0,
          ...measured,
        };
      });
    for (const key of components) {
      summary[key].liters = rounded(summary[key].liters);
      summary[key].gallons = rounded(summary[key].liters / 19);
    }
    return {
      from: period.from,
      to: period.to,
      gallonLiters: 19,
      actors,
      rows,
      summary,
      config: variableConfig(),
    };
  });
  route("GET", "/api/payroll/:id", "reports", (ctx) => {
    const period = scope(ctx.query);
    d.find("users", ctx.params.id);
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman",
      0,
      10000000,
    );
    const where = " WHERE actor_id=? AND day>=? AND day<=?";
    const args = [ctx.params.id, period.from, period.to];
    const grouping = " GROUP BY day,shift_id,shift_number";
    const total = d.get(
      activitySql +
        "SELECT COUNT(*) total FROM (SELECT day FROM activities" +
        where +
        grouping +
        ")",
      ...args,
    ).total;
    const rates = ratesFor(ctx.params.id);
    const rows = d
      .all(
        activitySql +
          "SELECT day,shift_id,shift_number,MAX(closed_at) closed_at," +
          totalsSql +
          ",SUM(delivery_orders) delivery_orders,SUM(missing_capacity) missing_capacity FROM activities" +
          where +
          grouping +
          " ORDER BY day DESC,shift_number DESC,closed_at DESC LIMIT 30 OFFSET ?",
        ...args,
        offset,
      )
      .map((row) => ({
        day: row.day,
        shiftId: row.shift_id,
        shiftNumber: row.shift_number,
        closedAt: row.closed_at,
        ...measures(row, rates),
      }));
    return { rows, offset, total, hasMore: offset + rows.length < total };
  });
  route("PATCH", "/api/payroll/rates/:id", "reports", (ctx) => {
    const user = d.find("users", ctx.params.id);
    const previous = ratesFor(user.id);
    if (ctx.body.version !== previous.version)
      fail("Tarif sudah diubah. Muat ulang Payroll.", 409);
    const next = Object.fromEntries(
      components.map((key) => [
        key,
        integer(ctx.body[key], "Tarif per galon", 0, 10000000),
      ]),
    );
    next.version = previous.version + 1;
    d.run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "payroll.rate:" + user.id,
      JSON.stringify(next),
    );
    d.audit(ctx.user, "payroll.rates", user.id, previous, next);
    return next;
  });
}
function registerExplorer(
  route,
  d,
  { prefix, permission, byCounterAccount = false },
) {
  const listPath = byCounterAccount
    ? "/api/transactions"
    : "/api/report-transactions";
  const join =
    " FROM invoices i JOIN orders o ON o.id=i.order_id LEFT JOIN trips t ON t.id=i.trip_id LEFT JOIN users u ON u.id=t.courier_id";
  const daySql = "substr(datetime(i.recorded_at,'+7 hours'),1,10)";
  const channelKey = byCounterAccount
    ? "CASE WHEN i.trip_id IS NULL THEN 'counter:'||i.actor_id ELSE t.courier_id END"
    : "CASE WHEN i.trip_id IS NULL THEN 'counter' ELSE t.courier_id END";
  const channelName = byCounterAccount
    ? "CASE WHEN i.trip_id IS NULL THEN 'Take Away '||(SELECT name FROM users WHERE id=i.actor_id) ELSE 'Delivery '||u.name END"
    : "CASE WHEN i.trip_id IS NULL THEN 'Take Away / Depot' ELSE 'Delivery '||u.name END";
  const counterChannel = (channel) =>
    byCounterAccount ? channel.startsWith("counter:") : channel === "counter";
  function scope(query, level) {
    const p = d.period(query),
      clauses = ["i.recorded_at>=?", "i.recorded_at<?"],
      args = [p.start, p.end];
    const search = (query.get("search") || "").trim();
    if (search.length > 120) fail("Pencarian terlalu panjang.");
    if (search) {
      clauses.push(
        "instr(lower(i.customer_name||' '||i.customer_code),lower(?))>0",
      );
      args.push(search);
    }
    let channel = query.get("channel"),
      day = query.get("day"),
      trip = query.get("trip");
    if (level >= 1) {
      if (!channel || channel.length > 100) fail("Pilih akun laporan.");
      clauses.push(channelKey + "=?");
      args.push(channel);
    }
    if (level >= 2) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day || "") ||
        !Number.isFinite(Date.parse(day + "T00:00:00Z")) ||
        new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day ||
        day < p.from ||
        day > p.to
      )
        fail("Tanggal di luar periode laporan.");
      clauses.push(daySql + "=?");
      args.push(day);
    }
    if (level >= 3) {
      if (!trip || trip.length > 120) fail("Pilih trip laporan.");
      if (counterChannel(channel)) {
        if (trip !== "counter:" + day) fail("Kelompok depot belum benar.");
      } else {
        clauses.push("i.trip_id=?");
        args.push(trip);
      }
    }
    return { where: " WHERE " + clauses.join(" AND "), args, channel, day };
  }
  route("GET", prefix + "channels", permission, (ctx) => {
    const { where, args } = scope(ctx.query, 0);
    const rows = d.all(
      `SELECT ${channelKey} key,${channelName} name,COUNT(*) count,SUM(i.net+i.shipping) total` +
        join +
        where +
        ` GROUP BY ${channelKey} ORDER BY (i.trip_id IS NULL),name,key`,
      ...args,
    );
    return { rows, count: rows.reduce((s, r) => s + r.count, 0) };
  });
  route("GET", prefix + "days", permission, (ctx) => {
    const { where, args } = scope(ctx.query, 1);
    return {
      rows: d.all(
        "SELECT " +
          daySql +
          " day,COUNT(*) count,SUM(i.net+i.shipping) total" +
          join +
          where +
          " GROUP BY " +
          daySql +
          " ORDER BY day DESC",
        ...args,
      ),
    };
  });
  route("GET", prefix + "trips", permission, (ctx) => {
    const { where, args, day } = scope(ctx.query, 2);
    const restrictPhoto = byCounterAccount && !ctx.user.owner;
    const photo = restrictPhoto
      ? "CASE WHEN t.courier_id=? THEN t.photo_id END photo_id"
      : "t.photo_id";
    const rows = d.all(
      "SELECT COALESCE(i.trip_id,?) id,t.number,t.departed_at,t.day departure_day,COUNT(*) count,SUM(i.net+i.shipping) total" +
        "," +
        photo +
        join +
        where +
        " GROUP BY i.trip_id ORDER BY t.departed_at DESC,t.id DESC",
      "counter:" + day,
      ...(restrictPhoto ? [ctx.user.id] : []),
      ...args,
    );
    return { rows };
  });
  route("GET", listPath, permission, (ctx) => {
    const { where, args } = scope(
        ctx.query,
        ctx.query.get("trip") ? 3 : ctx.query.get("day") ? 2 : 1,
      ),
      offset = integer(
        Number(ctx.query.get("offset") || 0),
        "Halaman",
        0,
        10000000,
      );
    const total = d.get("SELECT COUNT(*) total" + join + where, ...args).total;
    const rows = d.all(
      `SELECT i.id,i.customer_code,i.customer_name,i.recorded_at,i.discount,i.shipping,
        i.net+i.shipping total,o.received_at,o.source,t.number trip_number,
        COALESCE((SELECT SUM(amount) FROM allocations WHERE invoice_id=i.id),0) paid,
        (SELECT GROUP_CONCAT(DISTINCT p.method) FROM allocations a
          JOIN payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id) payment_methods` +
        join +
        where +
        " ORDER BY i.recorded_at DESC,i.rowid DESC LIMIT 30 OFFSET ?",
      ...args,
      offset,
    );
    return { rows, total, offset, hasMore: offset + rows.length < total };
  });
  route("GET", listPath + "/:id", permission, (ctx) =>
    d.invoiceReceipt(ctx.params.id),
  );
}
