import { fail, has, id, dayWib } from "./domain.js";
import { waterSummary, waterBreakdown } from "./water-volume.js";
import { waterGroup, waterComparison } from "../src/water-stock.js";

export const WATER_METERS = [
  { id: "mineral", name: "Mineral" },
  { id: "ro1", name: "RO 1" },
  { id: "ro2", name: "RO 2" },
];
const decode = (row) =>
  row
    ? {
        ...row,
        readings: JSON.parse(row.readings),
        stock: row.stock_snapshot ? JSON.parse(row.stock_snapshot) : null,
        comparison: row.comparison_snapshot
          ? JSON.parse(row.comparison_snapshot)
          : null,
      }
    : null;
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
      fail("Lengkapi Stok sisa hari ini.");
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
          row.version !== product.version ||
          row.capacityLiters !== product.capacityLiters
        )
          fail(
            "Produk stok berubah. Muat ulang kontrol air sebelum menyimpan.",
            409,
          );
        if (!Number.isInteger(row.qty) || row.qty < 0 || row.qty > 1000000)
          fail("Stok sisa hari ini harus berupa jumlah utuh 0–1.000.000.");
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
      start = new Date(today + "T00:00:00+07:00").toISOString(),
      yesterdayStart = new Date(
        new Date(start).getTime() - 86400000,
      ).toISOString(),
      end = new Date(new Date(now).getTime() + 1).toISOString(),
      yesterday = decode(
        db
          .prepare(
            "SELECT * FROM water_checks WHERE created_at>=? AND created_at<? ORDER BY created_at DESC,rowid DESC LIMIT 1",
          )
          .get(yesterdayStart, start),
      ),
      firstToday = decode(
        db
          .prepare(
            "SELECT * FROM water_checks WHERE created_at>=? AND created_at<? ORDER BY created_at,rowid LIMIT 1",
          )
          .get(start, end),
      ),
      source = yesterday
        ? "previous-day"
        : firstToday
          ? "today-opening"
          : "manual",
      reference = yesterday || firstToday,
      baseline = {
        source,
        date: yesterday ? dayWib(yesterdayStart) : today,
        readings: reference
          ? reference.readings.map((row) => ({
              meterId: row.meterId,
              value: yesterday ? row.closing : row.opening,
            }))
          : [],
        stock: yesterday?.stock?.closing ?? firstToday?.stock?.opening ?? null,
      },
      sales = waterSummary(db, start, end);
    return {
      now,
      today,
      start,
      baseline,
      sales,
      salesGroups: waterBreakdown(db, start, end),
      daily: sales,
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
  route("POST", "/api/water-control", "waterControl", (ctx) => {
    const previous = latest(),
      body = ctx.body;
    if ((body.previousId ?? null) !== (previous?.id ?? null))
      fail(
        "Catatan shift sudah diperbarui staf lain. Muat ulang sebelum menyimpan.",
        409,
      );
    const p = preview();
    if (body.day !== undefined && body.day !== p.today)
      fail(
        "Tanggal sudah berganti. Muat ulang Kontrol air sebelum menyimpan.",
        409,
      );
    if (previous && previous.created_at > p.now)
      fail("Waktu server lebih awal dari catatan kontrol terakhir.", 409);
    const stock = parseStock(body.stock, previous, p.baseline.stock);
    if (
      !Array.isArray(body.readings) ||
      body.readings.length !== WATER_METERS.length ||
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
      JSON.stringify(comparison),
    );
    d.audit(ctx.user, "water.check", checkId, null, {
      usageLiters: usage,
      salesLiters: p.sales.liters,
      readings,
      stock,
      comparison,
    });
    return { id: checkId };
  });
}
