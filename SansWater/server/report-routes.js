import {
  fail,
  integer,
  has,
  dayWib,
  staffFinancialPeriod,
  hash,
  text,
} from "./domain.js";
import { saveFundSnapshot } from "./cash-ledger.js";
import { waterSummary, waterBreakdown, waterActivity } from "./water-volume.js";
import { waterComparison } from "../src/water-stock.js";
import { hasItemShipping, itemShipping } from "../src/order-pricing.js";

// Each level reads aggregates or one bounded page; invoice JSON is fetched only on detail open.
export function registerReportRoutes(route, d) {
  registerFinancialCorrections(route, d);
  registerPayroll(route, d);
  registerExplorer(route, d, { prefix: "/api/report-", permission: "reports" });
  route("GET", "/api/transactions/cash", "login", (ctx) => {
    staffFinancialPeriod(ctx.user, d.period(ctx.query), d.now());
    return d.transactionCash(ctx.query);
  });
  registerExplorer(route, d, {
    prefix: "/api/transactions/",
    permission: "login",
    byCounterAccount: true,
  });
}

function registerFinancialCorrections(route, d) {
  function owner(ctx) {
    if (!ctx.user.owner)
      fail("Hanya Owner yang dapat mengoreksi transaksi.", 403);
  }
  function view(key) {
    const invoice = d.invoice(key);
    const payments = d.all(
      "SELECT p.*,a.amount allocated FROM allocations a JOIN payments p ON p.id=a.payment_id WHERE a.invoice_id=? ORDER BY p.id",
      key,
    );
    return {
      ...invoice,
      payments,
      revision: hash(JSON.stringify({ invoice, payments })),
    };
  }
  function checked(ctx) {
    owner(ctx);
    const row = view(ctx.params.id);
    if (ctx.body.revision !== row.revision)
      fail("Transaksi sudah berubah. Buka ulang rincian.", 409);
    return row;
  }
  function refreshWater(before) {
    const cursor =
      d.get("SELECT rowid n FROM invoices WHERE id=?", before.id)?.n ??
      before.cursor;
    for (const row of d.all(
      "SELECT w.*,COALESCE(p.invoice_cursor,0) previous_cursor FROM water_checks w LEFT JOIN water_checks p ON p.id=w.previous_id WHERE w.start_at<=? AND w.created_at>=? AND w.invoice_cursor>=?",
      before.recorded_at,
      before.recorded_at,
      cursor,
    )) {
      if (before.recorded_at === row.start_at && cursor <= row.previous_cursor)
        continue;
      const snapshot = JSON.parse(row.comparison_snapshot || "null");
      if (snapshot?.scope !== "shift") continue;
      const end = new Date(Date.parse(row.created_at) + 1).toISOString();
      const readings = JSON.parse(row.readings),
        stock = JSON.parse(row.stock_snapshot),
        groups = waterBreakdown(
          d.db,
          row.start_at,
          end,
          row.previous_cursor,
          row.invoice_cursor,
        );
      const sales = waterSummary(
        d.db,
        row.start_at,
        end,
        row.previous_cursor,
        row.invoice_cursor,
      );
      snapshot.groups = waterComparison(
        readings,
        groups,
        stock.opening,
        stock.closing,
      );
      snapshot.activity = waterActivity(
        d.db,
        row.start_at,
        end,
        row.previous_cursor,
        row.invoice_cursor,
      );
      snapshot.ungroupedLiters = groups.ungroupedLiters;
      d.run(
        "UPDATE water_checks SET sales_liters=?,legacy_invoices=?,comparison_snapshot=? WHERE id=?",
        Math.round((groups.ro + groups.mineral) * 1e6) / 1e6,
        sales.legacyInvoices,
        JSON.stringify(snapshot),
        row.id,
      );
    }
  }
  function quantities(lines) {
    const m = new Map();
    for (const l of lines)
      m.set(l.productId, (m.get(l.productId) || 0) + l.qty);
    return m;
  }
  function stockDelta(ctx, before, lines) {
    const old = quantities(before.items),
      next = quantities(lines);
    for (const [productId, qty] of old) {
      if (
        !d.get(
          "SELECT 1 FROM stock_movements WHERE invoice_id=? AND product_id=?",
          before.id,
          productId,
        )
      )
        continue;
      const delta = qty - (next.get(productId) || 0);
      if (delta)
        d.stockMove(
          ctx.user,
          productId,
          delta,
          "sale.correct",
          null,
          "Koreksi transaksi " + before.id,
        );
    }
  }
  route("GET", "/api/invoices/:id/edit", "login", (ctx) => {
    owner(ctx);
    return view(ctx.params.id);
  });
  route("PATCH", "/api/invoices/:id", "login", (ctx) => {
    const before = checked(ctx),
      b = ctx.body,
      reason = text(b.reason, "Alasan koreksi", 500);
    if (!Array.isArray(b.items) || b.items.length !== before.items.length)
      fail("Daftar produk harus mengikuti transaksi asli.");
    const lines = before.items
      .map((old, index) => {
        const input = b.items[index];
        if (
          !input ||
          input.productId !== old.productId ||
          input.modeId !== old.modeId
        )
          fail("Produk transaksi belum benar.");
        return {
          ...old,
          qty: integer(input.qty, "Jumlah produk", 0, 1000000),
          price: integer(input.price, "Harga produk", 0, 100000000),
          ...(old.shippingRate !== undefined
            ? {
                shippingRate: integer(
                  input.shippingRate ?? old.shippingRate,
                  "Ongkir per unit",
                  0,
                  100000000,
                ),
              }
            : {}),
        };
      })
      .filter((l) => l.qty > 0);
    if (!lines.length)
      fail("Minimal satu produk. Gunakan Hapus untuk membatalkan transaksi.");
    const gross = lines.reduce((s, l) => s + l.qty * l.price, 0),
      discount = integer(b.discount, "Diskon", 0, gross),
      shipping = integer(
        hasItemShipping(lines) ? itemShipping(lines) : b.shipping,
        "Ongkir",
        0,
        1000000000,
      ),
      net = gross - discount,
      total = integer(net + shipping, "Total", 0, 1000000000000),
      paid = integer(b.paid, "Dibayar", 0, total);
    if (!before.customer_id && paid !== total)
      fail("Pembeli umum harus lunas.");
    const paymentChange =
      paid !== before.paid ||
      (paid > 0 &&
        b.method &&
        before.payments.some((p) => p.method !== b.method));
    if (paymentChange) {
      if (!["Tunai", "QRIS"].includes(b.method) && paid)
        fail("Pilih metode pembayaran.");
      for (const p of before.payments)
        if (
          p.amount !== p.allocated ||
          d.get("SELECT 1 FROM order_prepayments WHERE payment_id=?", p.id)
        )
          fail(
            "Pembayaran ini terkait tagihan lain atau pembayaran awal. Koreksi pembayaran tersebut terlebih dahulu.",
            409,
          );
    } else if (paid > total) fail("Koreksi pembayaran terlebih dahulu.");
    stockDelta(ctx, before, lines);
    // Keep the original per-product discount allocation whenever possible.
    const discounts = {},
      subtotals = new Map();
    let remaining = discount;
    for (const line of lines)
      subtotals.set(
        line.productId,
        (subtotals.get(line.productId) || 0) + line.qty * line.price,
      );
    for (const [productId, subtotal] of subtotals) {
      const value = Math.min(
        remaining,
        subtotal,
        before.discounts[productId] || 0,
      );
      if (value) discounts[productId] = value;
      remaining -= value;
    }
    for (const [productId, subtotal] of subtotals) {
      const value = Math.min(remaining, subtotal - (discounts[productId] || 0));
      if (value) discounts[productId] = (discounts[productId] || 0) + value;
      remaining -= value;
    }
    d.run(
      "UPDATE invoices SET items=?,discounts=?,net=?,discount=?,shipping=? WHERE id=?",
      JSON.stringify(lines),
      JSON.stringify(discounts),
      net,
      discount,
      shipping,
      before.id,
    );
    d.run(
      "DELETE FROM transaction_funds WHERE kind='invoice' AND object_id=?",
      before.id,
    );
    saveFundSnapshot(d.db, "invoice", before.id, lines, discounts, shipping);
    if (paymentChange) {
      for (const [index, p] of before.payments.entries()) {
        const amount = index === 0 ? paid : 0;
        d.run("DELETE FROM allocations WHERE payment_id=?", p.id);
        d.run(
          "UPDATE payments SET amount=?,method=?,tender=NULL,version=version+1 WHERE id=?",
          amount,
          b.method || p.method,
          p.id,
        );
        if (amount) d.allocate(p.id, [before.id], amount);
        d.audit(
          ctx.user,
          amount ? "payment.correct" : "payment.cancel",
          p.id,
          p,
          {
            amount,
            method: b.method || p.method,
            reason,
            invoiceId: before.id,
          },
        );
      }
      if (paid && !before.payments.length)
        d.payment(
          ctx.user,
          { paid, method: b.method },
          [before.id],
          before.customer_id,
          "sale",
          before.trip_id ? "delivery" : "counter",
        );
    }
    if (
      d.get("SELECT COUNT(*) n FROM invoices WHERE order_id=?", before.order_id)
        .n === 1
    ) {
      d.run(
        "UPDATE orders SET items=?,discounts=?,version=version+1 WHERE id=?",
        JSON.stringify(lines),
        JSON.stringify(discounts),
        before.order_id,
      );
      d.run(
        "UPDATE trip_orders SET items=? WHERE order_id=? AND trip_id=?",
        JSON.stringify(lines),
        before.order_id,
        before.trip_id,
      );
    }
    refreshWater(before);
    d.audit(ctx.user, "invoice.correct", before.id, before, {
      ...view(before.id),
      reason,
    });
    return view(before.id);
  });
  function deleteInvoice(ctx, before, reason) {
    before.cursor = d.get(
      "SELECT rowid n FROM invoices WHERE id=?",
      before.id,
    ).n;
    stockDelta(ctx, before, []);
    for (const p of d.all(
      "SELECT p.*,COALESCE(a.amount,0) allocated FROM payments p LEFT JOIN allocations a ON a.payment_id=p.id AND a.invoice_id=? WHERE a.invoice_id IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(p.scope) s WHERE s.value=?)",
      before.id,
      before.id,
    )) {
      const scope = JSON.parse(p.scope).filter((key) => key !== before.id);
      const advance = d.get(
        "SELECT order_id FROM order_prepayments WHERE payment_id=?",
        p.id,
      );
      const soleAdvance =
        advance &&
        !d.get(
          "SELECT 1 FROM invoices WHERE order_id=? AND id<>?",
          advance.order_id,
          before.id,
        ) &&
        !d.get(
          "SELECT 1 FROM allocations WHERE payment_id=? AND invoice_id<>?",
          p.id,
          before.id,
        );
      const amount = soleAdvance ? 0 : p.amount - p.allocated;
      d.run(
        "DELETE FROM allocations WHERE payment_id=? AND invoice_id=?",
        p.id,
        before.id,
      );
      d.run(
        "UPDATE payments SET amount=?,scope=?,tender=NULL,version=version+1 WHERE id=?",
        amount,
        JSON.stringify(scope),
        p.id,
      );
      d.audit(ctx.user, "payment.cancel", p.id, p, {
        amount,
        reason,
        invoiceId: before.id,
      });
    }
    d.run(
      "UPDATE stock_movements SET invoice_id=NULL WHERE invoice_id=?",
      before.id,
    );
    d.run("DELETE FROM allocations WHERE invoice_id=?", before.id);
    d.run(
      "DELETE FROM transaction_funds WHERE kind='invoice' AND object_id=?",
      before.id,
    );
    d.run("DELETE FROM invoices WHERE id=?", before.id);
    d.run(
      "UPDATE trip_orders SET outcome='cancel',reason=?,recorded_at=? WHERE trip_id=? AND order_id=?",
      reason,
      d.now(),
      before.trip_id,
      before.order_id,
    );
    if (!d.get("SELECT 1 FROM invoices WHERE order_id=?", before.order_id))
      d.run(
        "UPDATE orders SET status='cancel',reason=?,version=version+1 WHERE id=?",
        reason,
        before.order_id,
      );
    refreshWater(before);
    d.audit(ctx.user, "invoice.delete", before.id, before, {
      reason,
      cancelPayments: true,
    });
  }
  route("DELETE", "/api/invoices/:id", "login", (ctx) => {
    const before = checked(ctx);
    const reason = text(ctx.body.reason, "Alasan penghapusan", 500);
    if (ctx.body.confirmed !== true)
      fail("Konfirmasi pembatalan transaksi dan pembayaran.");
    deleteInvoice(ctx, before, reason);
    return { ok: true };
  });
  route("DELETE", "/api/orders/:id", "login", (ctx) => {
    if (!ctx.user.owner)
      fail("Hanya admin (Owner) yang dapat menghapus pesanan.", 403);
    const row = d.find("orders", ctx.params.id);
    if (ctx.body.confirmed !== true)
      fail("Konfirmasi penghapusan pesanan terlebih dahulu.");
    if (row.version !== ctx.body.version)
      fail("Pesanan sudah berubah. Muat ulang sebelum menghapus.", 409);
    const invoices = d.all(
      "SELECT id FROM invoices WHERE order_id=? ORDER BY rowid",
      row.id,
    );
    const advance = d.get(
      "SELECT payment_id FROM order_prepayments WHERE order_id=?",
      row.id,
    );
    const attempts = d.all(
      "SELECT * FROM trip_orders WHERE order_id=?",
      row.id,
    );
    const related =
      invoices.length > 0 ||
      !!advance ||
      attempts.length > 0 ||
      !!row.current_trip_id;
    // Older clients omit reason; null explicitly confirms removal without a reason.
    if (ctx.body.reason === undefined && (related || row.kind !== "delivery"))
      fail(
        "Isi alasan untuk menghapus pesanan yang memiliki catatan transaksi, pembayaran, atau trip.",
        409,
      );
    const reason =
      ctx.body.reason == null
        ? null
        : text(ctx.body.reason, "Alasan penghapusan", 500);
    for (const invoice of invoices)
      deleteInvoice(ctx, view(invoice.id), reason);
    if (advance) {
      const payment = d.find("payments", advance.payment_id);
      if (payment.amount > 0) {
        const remaining = d.get(
          "SELECT COALESCE(SUM(amount),0) total FROM allocations WHERE payment_id=?",
          payment.id,
        ).total;
        d.run(
          "UPDATE payments SET amount=?,tender=NULL,version=version+1 WHERE id=?",
          remaining,
          payment.id,
        );
        d.audit(ctx.user, "payment.cancel", payment.id, payment, {
          amount: remaining,
          reason,
          orderId: row.id,
        });
      }
      d.run("DELETE FROM order_prepayments WHERE order_id=?", row.id);
    }
    d.run("DELETE FROM trip_orders WHERE order_id=?", row.id);
    for (const attempt of attempts) {
      d.run(
        "UPDATE trips SET closed_at=? WHERE id=? AND closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM trip_orders WHERE trip_id=? AND outcome='delivery')",
        d.now(),
        attempt.trip_id,
        attempt.trip_id,
      );
    }
    d.audit(ctx.user, "order.delete", row.id, row, {
      deleted: true,
      reason,
      invoiceIds: invoices.map((invoice) => invoice.id),
      tripAttempts: attempts,
    });
    d.run("DELETE FROM orders WHERE id=?", row.id);
    return { ok: true, id: row.id };
  });
  route("GET", "/api/payments/:id", "login", (ctx) => {
    owner(ctx);
    return d.find("payments", ctx.params.id);
  });
  route("DELETE", "/api/payments/:id", "login", (ctx) => {
    owner(ctx);
    const p = d.find("payments", ctx.params.id);
    if (p.version !== ctx.body.version)
      fail("Pembayaran sudah berubah. Muat ulang.", 409);
    if (ctx.body.confirmed !== true) fail("Konfirmasi pembatalan pembayaran.");
    const reason = text(ctx.body.reason, "Alasan pembatalan", 500);
    d.run("DELETE FROM allocations WHERE payment_id=?", p.id);
    d.run(
      "UPDATE payments SET amount=0,tender=NULL,version=version+1 WHERE id=?",
      p.id,
    );
    d.audit(ctx.user, "payment.cancel", p.id, p, { amount: 0, reason });
    return { ok: true };
  });
}

function registerPayroll(route, d) {
  const components = [
    "ro1Shift1",
    "ro2Shift1",
    "mineralShift1",
    "ro1Shift2",
    "ro2Shift2",
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
  ), delivery_lines AS (
    -- Classify frozen invoice names, matching waterGroup's RO/Mineral word boundary.
    -- Branded water and other goods count as items even if they have a capacity.
    SELECT i.id,json_extract(line.value,'$.qty') qty,
      json_extract(line.value,'$.capacityLiters') capacity,
      lower(trim(COALESCE(json_extract(line.value,'$.name'),''))) name
    FROM assigned i,json_each(i.items) line
  ), classified_lines AS (
    SELECT *,name IN ('ro','mineral') OR name GLOB 'ro[^a-z0-9_]*'
      OR name GLOB 'mineral[^a-z0-9_]*' is_water FROM delivery_lines
  ), delivery_totals AS (
    SELECT id,SUM(CASE WHEN is_water THEN COALESCE(capacity,0)*qty ELSE 0 END) liters,
      SUM(CASE WHEN is_water THEN 0 ELSE qty END) items,
      MAX(is_water AND (capacity IS NULL OR capacity<=0)) missing_capacity
    FROM classified_lines GROUP BY id
  ), meter_readings AS (
    SELECT w.actor_id,w.id,
      COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(w.created_at,'+7 hours'),1,10)) day,
      w.id shift_id,${shiftNumberSql} shift_number,w.created_at closed_at,
      COALESCE((SELECT SUM(json_extract(r.value,'$.liters')) FROM json_each(w.readings) r WHERE json_extract(r.value,'$.meterId')='ro1'),0) ro1,
      COALESCE((SELECT SUM(json_extract(r.value,'$.liters')) FROM json_each(w.readings) r WHERE json_extract(r.value,'$.meterId')='ro2'),0) ro2,
      COALESCE((SELECT SUM(json_extract(r.value,'$.liters')) FROM json_each(w.readings) r WHERE json_extract(r.value,'$.meterId')='mineral'),0) mineral,
      COALESCE(json_extract(a.value,'$.ro1'),json_extract(a.value,'$.ro'),w.actor_id) ro1_actor,
      COALESCE(json_extract(a.value,'$.ro2'),json_extract(a.value,'$.ro'),w.actor_id) ro2_actor,
      COALESCE(json_extract(a.value,'$.mineral'),w.actor_id) mineral_actor
    FROM water_checks w LEFT JOIN settings a ON a.key='payroll.assignment:'||w.id
    WHERE json_extract(w.comparison_snapshot,'$.scope')='shift'
  ), raw_activities AS (
    SELECT ro1_actor actor_id,day,shift_id,shift_number,closed_at,ro1,0 ro2,0 mineral,
      0 delivery,0 delivery_items,0 delivery_orders,0 missing_capacity FROM meter_readings
    UNION ALL
    SELECT ro2_actor,day,shift_id,shift_number,closed_at,0,ro2,0,0,0,0,0 FROM meter_readings
    UNION ALL
    SELECT mineral_actor,day,shift_id,shift_number,closed_at,0,0,mineral,
      0,0,0,0 FROM meter_readings
    UNION ALL
    SELECT i.courier_id,
      COALESCE(json_extract(w.comparison_snapshot,'$.shiftDate'),substr(datetime(i.recorded_at,'+7 hours'),1,10)) day,
      w.id,${shiftNumberSql},w.created_at,0,0,0,
      COALESCE(v.liters,0),COALESCE(v.items,0),1,COALESCE(v.missing_capacity,0)
    FROM assigned i LEFT JOIN water_checks w ON w.id=i.shift_id
      LEFT JOIN delivery_totals v ON v.id=i.id
  ), activities AS (
    SELECT actor_id,day,shift_id,shift_number,closed_at,
      CASE WHEN shift_number=1 THEN ro1 ELSE 0 END ro1Shift1,
      CASE WHEN shift_number=1 THEN ro2 ELSE 0 END ro2Shift1,
      CASE WHEN shift_number=1 THEN mineral ELSE 0 END mineralShift1,
      CASE WHEN shift_number=2 THEN ro1 ELSE 0 END ro1Shift2,
      CASE WHEN shift_number=2 THEN ro2 ELSE 0 END ro2Shift2,
      CASE WHEN shift_number=2 THEN mineral ELSE 0 END mineralShift2,
      delivery,delivery_items,delivery_orders,missing_capacity
    FROM raw_activities
  ) `;
  const totalsSql = [...components, "delivery_items"]
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
      ...Object.fromEntries(
        components.map((key) => [
          key,
          stored[key] ?? stored[key.replace(/^ro[12]/, "ro")] ?? 0,
        ]),
      ),
    };
  }
  function measures(row, rates) {
    const amounts = Object.fromEntries(
      components.map((key) => {
        const items = key === "delivery" ? row.delivery_items || 0 : 0;
        const units = row[key] / 19 + items;
        return [
          key,
          {
            liters: rounded(row[key]),
            gallons: rounded(row[key] / 19),
            rate: rates[key],
            ...(key === "delivery" ? { items, units: rounded(units) } : {}),
            amount: Math.round(units * rates[key]),
          },
        ];
      }),
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
          meters: Object.fromEntries(
            components
              .filter((k) => k !== "delivery")
              .map((k) => [
                k,
                saved.meters[k] ||
                  saved.meters[k.replace(/^ro[12]/, "ro")] || {
                    actor: "",
                    rate: 0,
                  },
              ]),
          ),
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
    if (!ctx.user.owner) fail("Hanya Owner yang dapat mengubah payroll.", 403);
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
        .map((key) => [
          key,
          validate(
            ctx.body.meters?.[key] ??
              ctx.body.meters?.[key.replace(/^ro[12]/, "ro")],
          ),
        ]),
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
    if (!ctx.user.owner) fail("Hanya Owner yang dapat mengubah payroll.", 403);
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
    const stored = row ? JSON.parse(row.value) : {};
    return {
      version: stored.version || 0,
      ro1: stored.ro1 || stored.ro || shift.actor_id,
      ro2: stored.ro2 || stored.ro || shift.actor_id,
      mineral: stored.mineral || shift.actor_id,
    };
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
    if (!ctx.user.owner) fail("Hanya Owner yang dapat mengubah payroll.", 403);
    const shift = d.find("water_checks", ctx.params.id);
    if (JSON.parse(shift.comparison_snapshot).scope !== "shift")
      fail("Catatan bukan penutupan shift.");
    ctx.body = {
      ...ctx.body,
      ro1: ctx.body.ro1 ?? ctx.body.ro,
      ro2: ctx.body.ro2 ?? ctx.body.ro,
      ro1Rate: ctx.body.ro1Rate ?? ctx.body.roRate,
      ro2Rate: ctx.body.ro2Rate ?? ctx.body.roRate,
    };
    const previous = assignmentFor(shift);
    if (ctx.body.version !== previous.version)
      fail("Petugas sudah diubah. Muat ulang Payroll.", 409);
    for (const key of ["ro1", "ro2", "mineral"]) {
      if (typeof ctx.body[key] !== "string" || !ctx.body[key])
        fail("Pilih penanggung jawab meteran.");
      const user = d.find("users", ctx.body[key]);
      if (!user.active && previous[key] !== user.id)
        fail("Pilih akun yang aktif.");
    }
    const shiftNumber = d.get(
      "SELECT " + shiftNumberSql + " number FROM water_checks w WHERE w.id=?",
      shift.id,
    ).number;
    const changedRates = new Map();
    for (const key of ["ro1", "ro2", "mineral"]) {
      if (!ctx.body[key + "Rate"]) continue;
      const rate = ctx.body[key + "Rate"];
      const actor = ctx.body[key];
      const before = ratesFor(actor);
      if (rate.version !== before.version)
        fail("Tarif sudah diubah. Muat ulang Payroll.", 409);
      const component = key + "Shift" + shiftNumber;
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
      ro1: ctx.body.ro1,
      ro2: ctx.body.ro2,
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
  route("GET", "/api/payroll", "login", (ctx) => {
    const ownView = ctx.query.get("view") === "own";
    const full = !ownView && has(ctx.user, "reports");
    const requestedPeriod = scope(ctx.query);
    const period = ownView
      ? requestedPeriod
      : staffFinancialPeriod(ctx.user, requestedPeriod, d.now());
    if (
      !full &&
      ctx.query.get("actor") &&
      ctx.query.get("actor") !== ctx.user.id
    )
      fail("Hanya dapat melihat payroll sendiri.", 403);
    const actors = d.all("SELECT id,name,active FROM users ORDER BY name,id");
    const actor = full ? ctx.query.get("actor") || "" : ctx.user.id;
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
    summary.delivery.items = 0;
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
        summary.delivery.items += measured.components.delivery.items;
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
    summary.delivery.units = rounded(
      summary.delivery.liters / 19 + summary.delivery.items,
    );
    const config = variableConfig();
    if (!full) {
      // Meter responsibility follows the configured assignee; courier work follows the trip account.
      const allTotals = d.get(
        activitySql +
          "SELECT " +
          totalsSql +
          " FROM activities WHERE day>=? AND day<=?",
        period.from,
        period.to,
      );
      for (const key of components.filter((k) => k !== "delivery")) {
        const rule = config.meters[key];
        const liters = rule.actor === ctx.user.id ? rounded(allTotals[key]) : 0;
        summary[key] = {
          liters,
          gallons: rounded(liters / 19),
          amount: Math.round((liters / 19) * (rule.rate || 0)),
        };
        if (rule.actor !== ctx.user.id)
          config.meters[key] = { actor: "", rate: 0 };
      }
      config.drivers = Object.fromEntries(
        Object.entries(config.drivers).filter(([key]) => key === ctx.user.id),
      );
      const own = rows[0];
      if (own) {
        for (const key of components.filter((k) => k !== "delivery"))
          own.components[key] = {
            ...summary[key],
            rate: config.meters[key].rate,
          };
        own.components.delivery.rate = config.drivers[ctx.user.id]?.rate || 0;
        own.components.delivery.amount = Math.round(
          (own.components.delivery.liters / 19 +
            own.components.delivery.items) *
            own.components.delivery.rate,
        );
        own.amount = Object.values(own.components).reduce(
          (sum, c) => sum + c.amount,
          0,
        );
        summary.delivery.amount = own.components.delivery.amount;
      }
    }
    return {
      from: period.from,
      to: period.to,
      gallonLiters: 19,
      actors: full ? actors : actors.filter((u) => u.id === ctx.user.id),
      rows,
      summary,
      config,
      ownOnly: !full,
      readOnly: !ctx.user.owner,
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
    if (!ctx.user.owner) fail("Hanya Owner yang dapat mengubah payroll.", 403);
    const user = d.find("users", ctx.params.id);
    const previous = ratesFor(user.id);
    if (ctx.body.version !== previous.version)
      fail("Tarif sudah diubah. Muat ulang Payroll.", 409);
    const next = Object.fromEntries(
      components.map((key) => [
        key,
        integer(
          ctx.body[key] ?? ctx.body[key.replace(/^ro[12]/, "ro")],
          "Tarif per galon",
          0,
          10000000,
        ),
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
  function scope(ctx, level) {
    const query = ctx.query;
    const p = byCounterAccount
        ? staffFinancialPeriod(ctx.user, d.period(query), d.now())
        : d.period(query),
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
    const { where, args } = scope(ctx, 0);
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
    const { where, args } = scope(ctx, 1);
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
    const { where, args, day } = scope(ctx, 2);
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
        ctx,
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
  route("GET", listPath + "/:id", permission, (ctx) => {
    const row = d.invoiceReceipt(ctx.params.id);
    if (byCounterAccount)
      staffFinancialPeriod(
        ctx.user,
        { from: dayWib(row.recorded_at), to: dayWib(row.recorded_at) },
        d.now(),
      );
    return row;
  });
}
