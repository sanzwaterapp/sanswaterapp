import { fail, integer } from "./domain.js";

// Each level reads aggregates or one bounded page; invoice JSON is fetched only on detail open.
export function registerReportRoutes(route, d) {
  const join =
    " FROM invoices i LEFT JOIN trips t ON t.id=i.trip_id LEFT JOIN users u ON u.id=t.courier_id";
  const daySql = "substr(datetime(i.recorded_at,'+7 hours'),1,10)";
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
      if (channel === "counter") clauses.push("i.trip_id IS NULL");
      else {
        clauses.push("t.courier_id=?");
        args.push(channel);
      }
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
      if (channel === "counter") {
        if (trip !== "counter:" + day) fail("Kelompok depot belum benar.");
      } else {
        clauses.push("i.trip_id=?");
        args.push(trip);
      }
    }
    return { where: " WHERE " + clauses.join(" AND "), args, channel, day };
  }
  route("GET", "/api/report-channels", "reports", (ctx) => {
    const { where, args } = scope(ctx.query, 0);
    const rows = d.all(
      "SELECT CASE WHEN i.trip_id IS NULL THEN 'counter' ELSE t.courier_id END key,CASE WHEN i.trip_id IS NULL THEN 'Take Away / Depot' ELSE 'Delivery '||u.name END name,COUNT(*) count,SUM(i.net+i.shipping) total" +
        join +
        where +
        " GROUP BY CASE WHEN i.trip_id IS NULL THEN 'counter' ELSE t.courier_id END ORDER BY (i.trip_id IS NULL),name",
      ...args,
    );
    return { rows, count: rows.reduce((s, r) => s + r.count, 0) };
  });
  route("GET", "/api/report-days", "reports", (ctx) => {
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
  route("GET", "/api/report-trips", "reports", (ctx) => {
    const { where, args, day } = scope(ctx.query, 2);
    const rows = d.all(
      "SELECT COALESCE(i.trip_id,?) id,t.number,t.departed_at,t.photo_id,t.day departure_day,COUNT(*) count,SUM(i.net+i.shipping) total" +
        join +
        where +
        " GROUP BY i.trip_id ORDER BY t.departed_at DESC,t.id DESC",
      "counter:" + day,
      ...args,
    );
    return { rows };
  });
  route("GET", "/api/report-transactions", "reports", (ctx) => {
    const { where, args } = scope(ctx.query, 3),
      offset = integer(
        Number(ctx.query.get("offset") || 0),
        "Halaman",
        0,
        10000000,
      );
    const total = d.get("SELECT COUNT(*) total" + join + where, ...args).total;
    const rows = d.all(
      "SELECT i.id,i.customer_code,i.customer_name,i.recorded_at,i.discount,i.shipping,i.net+i.shipping total" +
        join +
        where +
        " ORDER BY i.recorded_at DESC,i.id DESC LIMIT 30 OFFSET ?",
      ...args,
      offset,
    );
    return { rows, total, offset, hasMore: offset + rows.length < total };
  });
  route("GET", "/api/report-transactions/:id", "reports", (ctx) =>
    d.invoice(ctx.params.id),
  );
}
