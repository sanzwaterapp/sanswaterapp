import { fail, has, id, dayWib, integer } from "./domain.js";
import { waterSummary, waterBreakdown, waterActivity } from "./water-volume.js";
import { waterGroup, waterComparison } from "../src/water-stock.js";

export const WATER_METERS = [
  { id: "mineral", name: "Mineral" },
  { id: "ro1", name: "RO 1" },
  { id: "ro2", name: "RO 2" },
];
const rounded = (n) => Math.round(n * 1e6) / 1e6;
function reading(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12 ||
    Number(value.toFixed(6)) !== value
  )
    fail("Angka meteran harus 0–1.000.000.000.000 liter, maksimal 6 desimal.");
  return value;
}

export function registerWaterControl(route, db, d) {
  const shiftDaySql =
    "COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(w.created_at,'+7 hours'),1,10))";
  const decode = (row) => {
    if (!row) return null;
    const snapshot = row.comparison_snapshot
      ? JSON.parse(row.comparison_snapshot)
      : null;
    const shift = snapshot?.scope === "shift";
    return {
      ...row,
      actor: shift ? snapshot.closedBy.name : row.actor,
      scope: shift ? "shift" : "legacy-day",
      activity: shift ? snapshot.activity : null,
      shiftDate: shift
        ? snapshot.shiftDate || dayWib(row.created_at)
        : dayWib(row.created_at),
      shiftNumber: shift
        ? snapshot.shiftNumber ||
          db
            .prepare(
              "SELECT COUNT(*) n FROM water_checks WHERE json_extract(comparison_snapshot,'$.scope')='shift' AND json_extract(comparison_snapshot,'$.shiftNumber') IS NULL AND substr(datetime(created_at,'+7 hours'),1,10)=? AND rowid<=(SELECT rowid FROM water_checks WHERE id=?)",
            )
            .get(dayWib(row.created_at), row.id).n
        : null,
      ungroupedLiters: shift ? snapshot.ungroupedLiters || 0 : 0,
      readings: JSON.parse(row.readings),
      stock: row.stock_snapshot ? JSON.parse(row.stock_snapshot) : null,
      comparison: shift ? snapshot.groups : snapshot,
    };
  };
  const stockOptions = (previous) => {
    const options = db
      .prepare(
        "SELECT id,name,capacity_liters,version FROM products WHERE capacity_liters IS NOT NULL AND NOT EXISTS(SELECT 1 FROM settings WHERE key='productArchived:'||products.id) ORDER BY rowid",
      )
      .all()
      .filter((p) => waterGroup(p.name))
      .map((p) => ({
        productId: p.id,
        name: p.name,
        group: waterGroup(p.name),
        capacityLiters: p.capacity_liters,
        version: p.version,
      }));
    const old = previous?.stock_snapshot
      ? JSON.parse(previous.stock_snapshot).closing
      : [];
    for (const row of old)
      if (row.qty > 0 && !options.some((p) => p.productId === row.productId))
        options.push({
          productId: row.productId,
          name: row.name,
          group: row.group,
          capacityLiters: row.capacityLiters,
          version: null,
          carried: true,
        });
    return options;
  };
  const parseStock = (body, previous, openingStock) => {
    if (
      body !== undefined &&
      (!body || typeof body !== "object" || Array.isArray(body))
    )
      fail("Isian stok belum benar.");
    const options = stockOptions(previous),
      old = decode(previous)?.stock;
    if (
      body === undefined &&
      (old?.closing.some((row) => row.qty > 0) ||
        openingStock?.some((row) => row.qty > 0))
    )
      fail("Lengkapi Stok sisa shift.");
    function parse(rows) {
      if (
        !Array.isArray(rows) ||
        rows.some((row) => !row || typeof row !== "object") ||
        rows.length !== options.length ||
        new Set(rows.map((row) => row.productId)).size !== options.length
      )
        fail(
          "Daftar stok berubah atau belum lengkap. Muat ulang kontrol air.",
          409,
        );
      return options.map((product) => {
        const row = rows.find((row) => row.productId === product.productId);
        if (
          !row ||
          row.capacityLiters !== product.capacityLiters ||
          (row.name !== undefined && row.name !== product.name) ||
          (row.group !== undefined && row.group !== product.group)
        )
          fail(
            "Produk stok berubah. Muat ulang kontrol air sebelum menyimpan.",
            409,
          );
        if (!Number.isInteger(row.qty) || row.qty < 0 || row.qty > 1000000)
          fail("Stok sisa shift harus berupa jumlah utuh 0–1.000.000.");
        return {
          productId: product.productId,
          name: product.name,
          group: product.group,
          capacityLiters: product.capacityLiters,
          qty: row.qty,
        };
      });
    }
    const zeros = options.map((p) => ({ ...p, qty: 0 }));
    return {
      opening: openingStock ?? parse(body?.opening ?? zeros),
      closing: parse(body === undefined ? zeros : body.closing),
    };
  };
  const latest = () =>
    db
      .prepare(
        "SELECT w.*,u.name actor FROM water_checks w JOIN users u ON u.id=w.actor_id ORDER BY w.rowid DESC LIMIT 1",
      )
      .get();
  const preview = () => {
    const now = d.now(),
      today = dayWib(now),
      previous = decode(latest());
    let nextShiftDate = today;
    let nextShiftNumber = 1;
    if (previous?.scope === "shift") {
      const secondShiftAlreadyRecorded =
        previous.shiftNumber === 1 &&
        db
          .prepare(
            "SELECT w.* FROM water_checks w WHERE json_extract(w.comparison_snapshot,'$.scope')='shift' AND " +
              shiftDaySql +
              "=?",
          )
          .all(previous.shiftDate)
          .some((row) => decode(row).shiftNumber >= 2);
      if (previous.shiftNumber === 1 && !secondShiftAlreadyRecorded) {
        nextShiftDate = previous.shiftDate;
        nextShiftNumber = 2;
      } else {
        nextShiftDate = new Date(Date.parse(previous.shiftDate) + 86400000)
          .toISOString()
          .slice(0, 10);
      }
    }
    const start =
      previous?.created_at || new Date(today + "T00:00:00+07:00").toISOString();
    const end = new Date(Date.parse(now) + 1).toISOString();
    const cursor = previous?.invoice_cursor || 0;
    const baseline = {
      source: previous ? "previous-shift" : "manual",
      date: previous ? dayWib(previous.created_at) : today,
      readings:
        previous?.readings.map((row) => ({
          meterId: row.meterId,
          value: row.closing,
        })) || [],
      stock: previous?.stock?.closing || null,
    };
    const salesGroups = waterBreakdown(db, start, end, cursor);
    const sales = {
      ...waterSummary(db, start, end, cursor),
      liters: rounded(salesGroups.ro + salesGroups.mineral),
    };
    return {
      now,
      today,
      start,
      baseline,
      sales,
      salesGroups,
      activity: waterActivity(db, start, end, cursor),
      daily: sales,
      nextShiftDate,
      nextShiftNumber,
    };
  };
  route("GET", "/api/water-control", "login", (ctx) => {
    if (!has(ctx.user, "waterControl") && !has(ctx.user, "reports"))
      fail("Tidak ada akses kontrol air.", 403);
    const previous = latest();
    return {
      meters: WATER_METERS,
      unit: "liter",
      previous: decode(previous),
      stockProducts: stockOptions(previous),
      ...preview(),
      history: db
        .prepare(
          "SELECT w.*,u.name actor FROM water_checks w JOIN users u ON u.id=w.actor_id ORDER BY w.rowid DESC LIMIT 5",
        )
        .all()
        .map(decode),
    };
  });
  function readAccess(user) {
    if (!has(user, "waterControl") && !has(user, "reports"))
      fail("Tidak ada akses laporan kontrol air.", 403);
  }
  const summaryRow = (check) => {
    const expectedLiters = rounded(
      (check.comparison || []).reduce(
        (sum, group) => sum + group.expectedLiters,
        0,
      ),
    );
    return {
      id: check.id,
      scope: check.scope,
      startAt: check.start_at,
      closedAt: check.created_at,
      actor: check.actor,
      actorId: check.actor_id,
      shiftDate: check.shiftDate,
      shiftNumber: check.shiftNumber,
      usageLiters: check.usage_liters,
      salesLiters: check.sales_liters,
      expectedLiters: check.comparison ? expectedLiters : check.sales_liters,
      differenceLiters: rounded(
        check.usage_liters -
          (check.comparison ? expectedLiters : check.sales_liters),
      ),
      legacyInvoices: check.legacy_invoices,
      ungroupedLiters: check.ungroupedLiters,
      groups: (check.comparison || []).map(
        ({ group, name, salesLiters, usageLiters, differenceLiters }) => ({
          group,
          name,
          salesLiters,
          usageLiters,
          differenceLiters,
        }),
      ),
      activity: check.activity
        ? {
            deliveryOrders: check.activity.deliveryOrders,
            counterOrders: check.activity.counterOrders,
            deliveredUnits: check.activity.deliveredUnits,
            counterUnits: check.activity.counterUnits,
          }
        : null,
    };
  };
  route("GET", "/api/water-reports", "login", (ctx) => {
    readAccess(ctx.user);
    const p = d.period(ctx.query),
      actor = ctx.query.get("actor");
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman",
      0,
      10000000,
    );
    const where =
      " WHERE " +
      shiftDaySql +
      ">=? AND " +
      shiftDaySql +
      "<=?" +
      (actor ? " AND w.actor_id=?" : "");
    const args = [p.from, p.to, ...(actor ? [actor] : [])];
    const join = " FROM water_checks w JOIN users u ON u.id=w.actor_id";
    const actors = db
      .prepare(
        "SELECT DISTINCT u.id,u.name FROM water_checks w JOIN users u ON u.id=w.actor_id ORDER BY u.name,u.id",
      )
      .all();
    const summary = {
      shiftCount: 0,
      legacyCount: 0,
      usageLiters: 0,
      salesLiters: 0,
      expectedLiters: 0,
      differenceLiters: 0,
      deliveredUnits: 0,
      counterUnits: 0,
      deliveryOrders: 0,
      legacyInvoices: 0,
      ungroupedLiters: 0,
      groups: [
        {
          group: "ro",
          name: "RO",
          usageLiters: 0,
          salesLiters: 0,
          expectedLiters: 0,
          differenceLiters: 0,
        },
        {
          group: "mineral",
          name: "Mineral",
          usageLiters: 0,
          salesLiters: 0,
          expectedLiters: 0,
          differenceLiters: 0,
        },
      ],
    };
    for (const raw of db
      .prepare("SELECT w.*,u.name actor" + join + where)
      .iterate(...args)) {
      const check = decode(raw);
      if (check.scope !== "shift") {
        summary.legacyCount++;
        continue;
      }
      const row = summaryRow(check);
      summary.shiftCount++;
      for (const field of [
        "usageLiters",
        "salesLiters",
        "expectedLiters",
        "differenceLiters",
        "legacyInvoices",
        "ungroupedLiters",
      ])
        summary[field] += row[field];
      for (const field of ["deliveredUnits", "counterUnits", "deliveryOrders"])
        summary[field] += row.activity[field];
      for (const group of summary.groups) {
        const source = check.comparison.find((g) => g.group === group.group);
        for (const field of [
          "usageLiters",
          "salesLiters",
          "expectedLiters",
          "differenceLiters",
        ])
          group[field] += source[field];
      }
    }
    for (const field of [
      "usageLiters",
      "salesLiters",
      "expectedLiters",
      "differenceLiters",
    ]) {
      summary[field] = rounded(summary[field]);
      for (const group of summary.groups) group[field] = rounded(group[field]);
    }
    if (ctx.query.get("by") === "day") {
      const rows = db
        .prepare(
          `SELECT ${shiftDaySql} AS day, COUNT(*) AS count${join}${where}
           GROUP BY day ORDER BY day DESC LIMIT 30 OFFSET ?`,
        )
        .all(...args, offset);
      const { total } = db
        .prepare(
          `SELECT COUNT(DISTINCT ${shiftDaySql}) AS total${join}${where}`,
        )
        .get(...args);
      return {
        periodSummary: summary,
        rows,
        total,
        offset,
        hasMore: offset + rows.length < total,
        actors,
      };
    }
    const rows = db
      .prepare(
        "SELECT w.*,u.name actor" +
          join +
          where +
          " ORDER BY w.created_at DESC,w.rowid DESC LIMIT 30 OFFSET ?",
      )
      .all(...args, offset)
      .map(decode)
      .map(summaryRow);
    const total = summary.shiftCount + summary.legacyCount;
    return {
      summary,
      rows,
      total,
      offset,
      hasMore: offset + rows.length < total,
      actors,
    };
  });
  route("GET", "/api/water-reports/:id", "login", (ctx) => {
    readAccess(ctx.user);
    const row = db
      .prepare(
        "SELECT w.*,u.name actor FROM water_checks w JOIN users u ON u.id=w.actor_id WHERE w.id=?",
      )
      .get(ctx.params.id);
    if (!row) fail("Laporan kontrol air tidak ditemukan.", 404);
    const check = decode(row);
    const previous = row.previous_id
      ? db
          .prepare("SELECT readings FROM water_checks WHERE id=?")
          .get(row.previous_id)
      : null;
    const previousReadings = previous ? JSON.parse(previous.readings) : [];
    return {
      ...check,
      readings: check.readings.map((meter) => {
        const prior = previousReadings.find(
          (reading) => reading.meterId === meter.meterId,
        );
        return {
          ...meter,
          openingPhotoId:
            prior && prior.closing === meter.opening
              ? (prior.photoId ?? null)
              : null,
        };
      }),
    };
  });
  route("POST", "/api/water-control", "waterControl", (ctx) => {
    const previous = latest(),
      body = ctx.body;
    if ((body.previousId ?? null) !== (previous?.id ?? null))
      fail(
        "Catatan shift sudah diperbarui staf lain. Muat ulang sebelum menyimpan.",
        409,
      );
    const p = preview();
    const shiftDate = body.shiftDate ?? p.nextShiftDate;
    if (
      typeof shiftDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ||
      Number.isNaN(Date.parse(shiftDate)) ||
      new Date(shiftDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        shiftDate ||
      (body.shiftDate !== undefined && shiftDate > p.today)
    )
      fail("Tanggal shift belum benar.");
    const shiftNumber = integer(
      body.shiftNumber ?? p.nextShiftNumber,
      "Nomor shift",
      1,
      2,
    );
    if (p.nextShiftDate > p.today)
      fail(
        "Kedua shift sudah ditutup. Shift 1 tersedia pada " +
          p.nextShiftDate +
          ".",
        409,
      );
    if (shiftDate !== p.nextShiftDate || shiftNumber !== p.nextShiftNumber)
      fail(
        "Shift berikutnya adalah Shift " +
          p.nextShiftNumber +
          " pada " +
          p.nextShiftDate +
          ".",
        409,
      );
    if (previous && Date.parse(previous.created_at) > Date.parse(p.now))
      fail("Waktu server lebih awal dari catatan kontrol terakhir.", 409);
    const stock = parseStock(body.stock, previous, p.baseline.stock);
    if (
      !Array.isArray(body.readings) ||
      body.readings.length !== WATER_METERS.length ||
      body.readings.some((row) => !row || typeof row !== "object") ||
      new Set(body.readings.map((r) => r.meterId)).size !== WATER_METERS.length
    )
      fail("Lengkapi ketiga meteran air.");
    const readings = WATER_METERS.map((meter) => {
      const row = body.readings.find((r) => r.meterId === meter.id);
      if (!row) fail("Meteran belum benar.");
      const opening =
          p.baseline.source !== "manual"
            ? p.baseline.readings.find((r) => r.meterId === meter.id).value
            : reading(row.opening),
        closing = reading(row.closing);
      if (closing < opening)
        fail(
          "Angka akhir " +
            meter.name +
            " tidak boleh lebih kecil dari angka awal.",
        );
      return {
        meterId: meter.id,
        name: meter.name,
        opening,
        closing,
        liters: rounded(closing - opening),
        photoId: d.photo(ctx.user, row.photo, "water-meter"),
      };
    });
    const usage = rounded(readings.reduce((s, r) => s + r.liters, 0)),
      checkId = id();
    const comparison = waterComparison(
      readings,
      p.salesGroups,
      stock.opening,
      stock.closing,
    );
    d.run(
      "INSERT INTO water_checks(id,previous_id,start_at,created_at,actor_id,readings,usage_liters,sales_liters,legacy_invoices,invoice_cursor,stock_snapshot,comparison_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      checkId,
      previous?.id || null,
      p.start,
      p.now,
      ctx.user.id,
      JSON.stringify(readings),
      usage,
      p.sales.liters,
      p.sales.legacyInvoices,
      db.prepare("SELECT COALESCE(MAX(rowid),0) cursor FROM invoices").get()
        .cursor,
      JSON.stringify(stock),
      JSON.stringify({
        scope: "shift",
        shiftDate,
        shiftNumber,
        closedBy: {
          id: ctx.user.id,
          name: ctx.user.name,
          username: ctx.user.username,
        },
        activity: p.activity,
        ungroupedLiters: p.salesGroups.ungroupedLiters,
        groups: comparison,
      }),
    );
    d.audit(ctx.user, "water.check", checkId, null, {
      shiftDate,
      shiftNumber,
      usageLiters: usage,
      salesLiters: p.sales.liters,
      readings,
      stock,
      comparison,
    });
    return {
      id: checkId,
      closedAt: p.now,
      actor: ctx.user.name,
      shiftDate,
      shiftNumber,
    };
  });
}
