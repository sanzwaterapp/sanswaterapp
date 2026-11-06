import { fail, integer } from "./domain.js";

// Each level reads aggregates or one bounded page; invoice JSON is fetched only on detail open.
export function registerReportRoutes(route, d) {
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
        "," + photo +
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
