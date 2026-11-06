import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { salesBreakdown } from "./sales-breakdown.js";
import { reportReceipts } from "./report-receipts.js";
import { cashFlowSummary } from "./cash-flow.js";
import {
  discountEligible,
  hasItemShipping,
  itemShipping,
} from "../src/order-pricing.js";
import { orderProgress, orderLineKey } from "../src/order-progress.js";
import {
  cashFundReport,
  saveFundSnapshot,
  categoryFund,
} from "./cash-ledger.js";

export const PERMISSIONS = [
  "orders",
  "trips",
  "customers",
  "counter",
  "debts",
  "stock",
  "catalog",
  "reports",
  "expenses",
  "staff",
  "correct",
  "display",
  "attendanceView",
  "waterControl",
];
export const id = () => randomUUID();
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const dayWib = (date) =>
  new Date(new Date(date).getTime() + 7 * 3600000).toISOString().slice(0, 10);
export const has = (user, permission) =>
  !!user.owner || user.permissions.includes(permission);
export function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function requireAccess(user, permission) {
  if (!has(user, permission)) fail("Akun ini tidak memiliki akses.", 403);
}
export function text(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`${label} belum benar.`);
  return value.trim();
}
export function integer(value, label, min = 0, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} belum benar.`);
  return value;
}
export function passwordHash(password) {
  text(password, "Kata sandi", 200);
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, stored) {
  const [salt, key] = stored.split(":");
  const result = scryptSync(String(password), salt, 64);
  return timingSafeEqual(result, Buffer.from(key, "hex"));
}
export function safeUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    owner: !!row.owner,
    active: !!row.active,
    permissions: JSON.parse(row.permissions),
  };
}
export const decodeProduct = (row) => ({
  ...row,
  tracked: !!row.tracked,
  modes: JSON.parse(row.modes),
  capacityLiters: row.capacity_liters ?? null,
});
export const decodeOrder = (row) => ({
  ...row,
  items: JSON.parse(row.items),
  discounts: JSON.parse(row.discounts || "{}"),
});
export const decodeInvoice = (row) => ({
  ...row,
  items: JSON.parse(row.items),
  discounts: JSON.parse(row.discounts),
  total: row.net + row.shipping,
  paid: row.paid || 0,
  left: row.net + row.shipping - (row.paid || 0),
});

export function createDomain(
  db,
  clock = () => new Date().toISOString(),
  photoStorage = null,
) {
  const now = () => new Date(clock()).toISOString();
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function audit(user, action, objectId, before, after) {
    run(
      "INSERT INTO audit VALUES(?,?,?,?,?,?,?)",
      id(),
      user.id,
      action,
      objectId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      now(),
    );
  }
  function find(table, key) {
    const row = get(`SELECT * FROM ${table} WHERE id=?`, key);
    if (!row) fail("Data tidak ditemukan.", 404);
    return row;
  }
  function photo(user, value, kind) {
    if (typeof value !== "string") fail("Foto wajib dilengkapi.");
    const match = value.match(
      /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
    );
    if (!match) fail("Foto harus JPEG, PNG atau WebP.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024)
      fail("Ukuran foto maksimal 5 MB.");
    const valid =
      match[1] === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : match[1] === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid) fail("Isi berkas foto tidak sesuai formatnya.");
    const photoId = id();
    run(
      "INSERT INTO photos VALUES(?,?,?,?,?,?)",
      photoId,
      kind,
      user.id,
      match[1],
      bytes,
      now(),
    );
    photoStorage?.queue({ id: photoId, mime: match[1], bytes });
    return photoId;
  }
  function items(
    input,
    allowEmpty = false,
    enforcePrices = false,
    allowedArchived = [],
  ) {
    if (
      !Array.isArray(input) ||
      input.length > 100 ||
      (!allowEmpty && !input.length)
    )
      fail("Pilih produk terlebih dahulu.");
    const seen = new Set();
    return input.map((line) => {
      const p = decodeProduct(find("products", line.productId)),
        mode = p.modes.find((m) => m.id === line.modeId);
      if (
        !allowedArchived.includes(p.id) &&
        get("SELECT value FROM settings WHERE key=?", "productArchived:" + p.id)
      )
        fail("Produk sudah dihapus dari katalog. Pilih produk lain.", 409);
      if (!mode) fail("Cara beli produk tidak ditemukan.");
      const key = p.id + ":" + mode.id;
      if (seen.has(key))
        fail("Gabungkan jumlah produk dan cara beli yang sama.");
      seen.add(key);
      if (enforcePrices && line.price !== mode.price)
        fail("Harga produk berubah. Muat ulang harga sebelum menyimpan.", 409);
      return {
        productId: p.id,
        modeId: mode.id,
        name: p.name,
        mode: mode.name,
        qty: integer(line.qty, "Jumlah", 1, 100000),
        price: mode.price,
        fund: categoryFund(db, p.category_id),
        capacityLiters: p.capacityLiters,
        ...(line.shippingRate !== undefined
          ? {
              shippingRate: integer(
                line.shippingRate,
                "Ongkir per unit",
                0,
                1000000,
              ),
            }
          : {}),
      };
    });
  }
  function customerInput(body, allowAnonymous = false) {
    if (body.customerId) {
      const c = find("customers", body.customerId);
      return { customerId: c.id, name: c.name, code: c.code };
    }
    return {
      customerId: null,
      name:
        allowAnonymous && !String(body.guestName || "").trim()
          ? "Pembeli umum"
          : text(body.guestName, "Nama pembeli"),
      code: "",
    };
  }
  function orderDiscounts(lines, input = {}, previous = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("Diskon belum benar.");
    const subtotals = {};
    for (const line of lines)
      subtotals[line.productId] =
        (subtotals[line.productId] || 0) + line.qty * line.price;
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => {
        if (!Object.hasOwn(subtotals, key)) fail("Diskon tidak sesuai produk.");
        if (
          Number(value) > Number(previous[key] || 0) &&
          !discountEligible(lines.find((line) => line.productId === key).name)
        )
          fail("Diskon hanya tersedia untuk produk RO dan Mineral.");
        return [key, integer(value, "Diskon", 0, subtotals[key])];
      }),
    );
  }
  function order(user, body, kind = "delivery") {
    const customer = customerInput(body, kind === "counter"),
      time = now();
    let received = time;
    if (kind === "delivery") {
      if (!["WhatsApp", "Telepon", "Depot", "Kurir"].includes(body.source))
        fail("Pilih asal pesanan.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.receivedTime || ""))
        fail("Jam pesanan belum benar.");
      received = new Date(
        dayWib(time) + "T" + body.receivedTime + ":00+07:00",
      ).toISOString();
      if (received > time)
        fail("Jam pesanan tidak boleh melewati waktu sekarang.");
    }
    const orderId = id(),
      lines = items(body.items || [], kind === "delivery"),
      discounts = orderDiscounts(lines, body.discounts);
    run(
      "INSERT INTO orders(id,customer_id,name,code,source,kind,received_at,created_at,status,items,created_by,discounts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      orderId,
      customer.customerId,
      customer.name,
      customer.code,
      kind === "delivery" ? body.source : "Depot",
      kind,
      received,
      time,
      "new",
      JSON.stringify(lines),
      user.id,
      JSON.stringify(discounts),
    );
    audit(user, "order.create", orderId, null, {
      kind,
      customerId: customer.customerId,
    });
    if (kind === "delivery" && body.paymentTiming !== undefined) {
      if (!["now", "courier"].includes(body.paymentTiming))
        fail("Pilih waktu pembayaran.");
      if (body.paymentTiming === "now") {
        if (!lines.length) fail("Pilih produk sebelum membayar.");
        if (!["Tunai", "QRIS"].includes(body.method))
          fail("Pilih metode Tunai atau QRIS.");
        const shipping = integer(
          hasItemShipping(lines) ? itemShipping(lines) : (body.shipping ?? 0),
          "Ongkir",
        );
        const amount = integer(
          lines.reduce((sum, line) => sum + line.qty * line.price, 0) -
            Object.values(discounts).reduce((sum, value) => sum + value, 0) +
            shipping,
          "Total pembayaran",
        );
        const paymentId = id();
        run(
          "INSERT INTO payments(id,customer_id,amount,method,scope,created_at,actor_id) VALUES(?,?,?,?,?,?,?)",
          paymentId,
          customer.customerId,
          amount,
          body.method,
          "[]",
          time,
          user.id,
        );
        run(
          "INSERT INTO order_prepayments VALUES(?,?,?,?,?)",
          orderId,
          paymentId,
          shipping,
          JSON.stringify(lines),
          JSON.stringify(discounts),
        );
        audit(user, "payment.prepay", paymentId, null, {
          orderId,
          amount,
          method: body.method,
        });
        saveFundSnapshot(db, "prepay", orderId, lines, discounts, shipping);
      }
    }
    return decodeOrder(find("orders", orderId));
  }
  function orderPrepayment(orderId) {
    const row = get(
      "SELECT op.*,p.amount,p.method,p.created_at,p.actor_id FROM order_prepayments op JOIN payments p ON p.id=op.payment_id WHERE op.order_id=?",
      orderId,
    );
    if (!row) return null;
    const order = find("orders", orderId);
    const lines = JSON.parse(order.items),
      discounts = JSON.parse(order.discounts);
    const total =
      lines.reduce((sum, line) => sum + line.qty * line.price, 0) -
      Object.values(discounts).reduce((sum, value) => sum + value, 0) +
      (hasItemShipping(JSON.parse(row.items))
        ? itemShipping(lines)
        : row.shipping);
    return {
      ...row,
      itemShipping: hasItemShipping(JSON.parse(row.items)),
      items: lines,
      discounts,
      total,
      available: Math.max(
        0,
        row.amount -
          get(
            "SELECT COALESCE(SUM(amount),0) n FROM allocations WHERE payment_id=?",
            row.payment_id,
          ).n,
      ),
      settled: row.amount === total,
    };
  }
  function deliveryProgress(order) {
    return orderProgress(
      typeof order.items === "string" ? JSON.parse(order.items) : order.items,
      typeof order.discounts === "string"
        ? JSON.parse(order.discounts)
        : order.discounts,
      all(
        "SELECT * FROM invoices WHERE order_id=? ORDER BY rowid",
        order.id,
      ).map((row) => ({
        ...row,
        items: JSON.parse(row.items),
        discounts: JSON.parse(row.discounts),
      })),
    );
  }
  const quantitySignature = (lines) =>
    JSON.stringify(
      lines
        .map((line) => [orderLineKey(line), line.qty])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  function auditOrderItems(user, order, lines, discounts) {
    audit(
      user,
      "order.items",
      order.id,
      {
        items:
          typeof order.items === "string"
            ? JSON.parse(order.items)
            : order.items,
        discounts:
          typeof order.discounts === "string"
            ? JSON.parse(order.discounts)
            : order.discounts,
      },
      {
        items: lines,
        discounts,
        editedBy: { id: user.id, username: user.username, name: user.name },
      },
    );
  }
  function quantityRevision(order, until = null) {
    const rows = all(
      "SELECT a.before_json,a.after_json,a.created_at,a.actor_id,u.username,u.name FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.object_id=? AND a.action='order.items'" +
        (until ? " AND a.created_at<=?" : "") +
        " ORDER BY a.rowid",
      order.id,
      ...(until ? [until] : []),
    );
    let first = null,
      last = null;
    for (const row of rows) {
      const before = JSON.parse(row.before_json || "{}"),
        after = JSON.parse(row.after_json || "{}");
      if (
        !before.items?.length ||
        !Array.isArray(after.items) ||
        quantitySignature(before.items) === quantitySignature(after.items)
      )
        continue;
      first ??= before.items;
      last = { ...row, after };
    }
    if (!last) return null;
    const current = until
      ? last.after.items
      : typeof order.items === "string"
        ? JSON.parse(order.items)
        : order.items;
    return {
      initialQty: first.reduce((sum, line) => sum + line.qty, 0),
      finalQty: current.reduce((sum, line) => sum + line.qty, 0),
      editedAt: last.created_at,
      editedBy: last.after.editedBy || {
        id: last.actor_id,
        username: last.username,
        name: last.name,
      },
    };
  }
  function stockMove(user, productId, qty, kind, invoiceId, note) {
    run(
      "UPDATE products SET stock=stock+?,version=version+1 WHERE id=?",
      qty,
      productId,
    );
    run(
      "INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?)",
      id(),
      productId,
      qty,
      kind,
      invoiceId,
      user.id,
      now(),
      note,
    );
  }
  const invoiceQuery = `SELECT i.*,COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.invoice_id=i.id),0) AS paid FROM invoices i`;
  function invoice(key) {
    const row = get(invoiceQuery + " WHERE i.id=?", key);
    if (!row) fail("Tagihan tidak ditemukan.", 404);
    return decodeInvoice(row);
  }
  function invoiceReceipt(key) {
    const row = invoice(key);
    const order = get(
      "SELECT received_at,source FROM orders WHERE id=?",
      row.order_id,
    );
    const methods = all(
      "SELECT DISTINCT p.method FROM allocations a JOIN payments p ON p.id=a.payment_id WHERE a.invoice_id=? ORDER BY p.method",
      key,
    ).map(({ method }) => method);
    return { ...row, ...order, methods };
  }
  function transactionCash(query) {
    const { start, end } = period(query);
    const { cashHolders } = salesBreakdown(db, start, end);
    return cashFlowSummary(db, start, end, cashHolders, { includeActive: true });
  }
  function allocate(paymentId, invoiceIds, amount) {
    let remaining = amount;
    const rows = invoiceIds
      .map(invoice)
      .sort(
        (a, b) =>
          Date.parse(a.recorded_at) - Date.parse(b.recorded_at) ||
          a.id.localeCompare(b.id),
      );
    if (rows.reduce((n, r) => n + r.left, 0) < amount)
      fail("Pembayaran melebihi sisa tagihan.");
    for (const row of rows) {
      if (!remaining) break;
      const part = Math.min(row.left, remaining);
      if (part > 0)
        run("INSERT INTO allocations VALUES(?,?,?)", paymentId, row.id, part);
      remaining -= part;
    }
  }
  function payment(
    user,
    body,
    invoiceIds,
    customerId,
    origin = "debt",
    channel = null,
  ) {
    const amount = integer(body.paid, "Dibayar");
    if (!amount) return null;
    if (!["Tunai", "QRIS"].includes(body.method))
      fail("Pilih metode Tunai atau QRIS.");
    const tender =
      body.method === "Tunai" &&
      body.tender !== undefined &&
      body.tender !== null
        ? integer(body.tender, "Uang diterima", amount)
        : null;
    const proof =
        body.method === "QRIS" && body.proof
          ? photo(user, body.proof, "proof")
          : null,
      paymentId = id();
    run(
      "INSERT INTO payments(id,customer_id,amount,method,tender,proof_id,scope,created_at,actor_id) VALUES(?,?,?,?,?,?,?,?,?)",
      paymentId,
      customerId,
      amount,
      body.method,
      tender,
      proof,
      JSON.stringify(invoiceIds),
      now(),
      user.id,
    );
    allocate(paymentId, invoiceIds, amount);
    audit(user, "payment.create", paymentId, null, {
      amount,
      method: body.method,
      invoiceIds,
      origin,
      channel:
        channel ||
        (get(
          "SELECT 1 FROM trips WHERE courier_id=? AND departed_at<=? LIMIT 1",
          user.id,
          now(),
        ) ||
        (has(user, "trips") && !has(user, "counter"))
          ? "delivery"
          : "counter"),
    });
    return paymentId;
  }
  function complete(user, orderRow, body, tripId = null) {
    if (
      ["done", "cancel"].includes(orderRow.status) ||
      (!tripId && get("SELECT id FROM invoices WHERE order_id=?", orderRow.id))
    )
      fail("Transaksi pesanan sudah tersimpan.", 409);
    const previousLines =
      typeof orderRow.items === "string"
        ? JSON.parse(orderRow.items)
        : orderRow.items;
    const progress = deliveryProgress(orderRow),
      prepayment = orderPrepayment(orderRow.id);
    const hasAdvance = prepayment?.amount > 0;
    let lines = items(
      body.items,
      false,
      !hasAdvance,
      previousLines.map((line) => line.productId),
    );
    // Older open clients may omit the new field; never silently drop a stored rate.
    lines = lines.map((line) => {
      const previous = previousLines.find(
        (old) => orderLineKey(old) === orderLineKey(line),
      );
      return line.shippingRate === undefined &&
        previous?.shippingRate !== undefined
        ? { ...line, shippingRate: previous.shippingRate }
        : line;
    });
    if (tripId) {
      const remaining = new Map(
        progress.remainingItems.map((line) => [orderLineKey(line), line]),
      );
      for (const line of lines) {
        const expected = remaining.get(orderLineKey(line));
        if (!expected || line.qty > expected.qty)
          fail(
            "Jumlah diserahkan melebihi sisa pesanan. Edit jumlah pesanan terlebih dahulu.",
            409,
          );
        if (!hasAdvance && line.price !== expected.price)
          fail(
            "Harga pesanan berubah. Edit produk pesanan sebelum mencatat pengantaran.",
            409,
          );
        if (hasAdvance) {
          if ((line.shippingRate || 0) !== (expected.shippingRate || 0))
            fail("Ongkir per unit mengikuti pesanan yang sudah dibayar.", 409);
          const submitted = body.items.find(
            (item) => orderLineKey(item) === orderLineKey(line),
          );
          if (submitted.price !== expected.price)
            fail("Harga mengikuti pesanan yang sudah dibayar.", 409);
          const original = JSON.parse(
            get(
              "SELECT items FROM order_prepayments WHERE order_id=?",
              orderRow.id,
            ).items,
          ).find((item) => orderLineKey(item) === orderLineKey(line));
          Object.assign(line, {
            price: expected.price,
            fund: original?.fund ?? line.fund,
            name: original?.name ?? expected.name,
            mode: original?.mode ?? expected.mode,
          });
        }
      }
    }
    if (!tripId)
      lines = lines.map((line) =>
        line.shippingRate === undefined ? line : { ...line, shippingRate: 0 },
      );
    const discounts = orderDiscounts(
      lines,
      body.discounts ??
        (tripId
          ? progress.remainingDiscounts
          : typeof orderRow.discounts === "string"
            ? JSON.parse(orderRow.discounts)
            : orderRow.discounts),
      typeof orderRow.discounts === "string"
        ? JSON.parse(orderRow.discounts)
        : orderRow.discounts,
    );
    const finalized = new Map(
      progress.deliveredItems.map((line) => [orderLineKey(line), { ...line }]),
    );
    for (const line of lines)
      finalized.set(orderLineKey(line), {
        ...line,
        qty: line.qty + (finalized.get(orderLineKey(line))?.qty || 0),
      });
    const finalItems = tripId ? [...finalized.values()] : lines;
    const finalDiscounts = { ...progress.usedDiscounts };
    for (const [key, amount] of Object.entries(discounts))
      finalDiscounts[key] = (finalDiscounts[key] || 0) + amount;
    const finalOrderTotal =
      finalItems.reduce((sum, line) => sum + line.qty * line.price, 0) -
      Object.values(finalDiscounts).reduce((sum, value) => sum + value, 0) +
      (hasItemShipping(finalItems) && (!prepayment || prepayment.itemShipping)
        ? itemShipping(finalItems)
        : prepayment?.shipping || 0);
    if (prepayment && finalOrderTotal < prepayment.amount)
      fail(
        "Jumlah baru menimbulkan kelebihan pembayaran. Selesaikan koreksi pembayaran terlebih dahulu.",
        409,
      );
    const subtotals = {};
    for (const line of lines)
      subtotals[line.productId] =
        (subtotals[line.productId] || 0) + line.qty * line.price;
    let discount = 0;
    for (const [key, subtotal] of Object.entries(subtotals))
      discount += integer(discounts[key] ?? 0, "Diskon", 0, subtotal);
    const shipping = tripId
      ? integer(
          hasItemShipping(lines) && (!hasAdvance || prepayment.itemShipping)
            ? itemShipping(lines)
            : (body.shipping ?? 0),
          "Ongkir",
        )
      : 0;
    if (
      hasAdvance &&
      !prepayment.itemShipping &&
      !progress.deliveredQty &&
      shipping !== prepayment.shipping
    )
      fail("Ongkir pengantaran pertama mengikuti pembayaran awal.", 409);
    const net = Object.values(subtotals).reduce((a, b) => a + b, 0) - discount;
    const total = integer(net + shipping, "Total tagihan");
    const advanceUsed = Math.min(prepayment?.available || 0, total);
    const paid = integer(body.paid, "Dibayar", 0, total - advanceUsed);
    if (!orderRow.customer_id && paid + advanceUsed !== total)
      fail("Pembeli umum harus membayar lunas.");
    if (
      orderRow.kind === "counter" &&
      body.paymentTiming === "now" &&
      paid !== total
    )
      fail("Bayar sekarang harus lunas.");
    const invoiceId = id();
    run(
      "INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      invoiceId,
      orderRow.id,
      orderRow.customer_id,
      orderRow.name,
      orderRow.code,
      tripId,
      net,
      shipping,
      discount,
      JSON.stringify(lines),
      JSON.stringify(discounts),
      now(),
      user.id,
    );
    saveFundSnapshot(db, "invoice", invoiceId, lines, discounts, shipping);
    const quantities = {};
    for (const line of lines)
      quantities[line.productId] = (quantities[line.productId] || 0) + line.qty;
    for (const [productId, qty] of Object.entries(quantities))
      if (find("products", productId).tracked)
        stockMove(
          user,
          productId,
          -qty,
          "sale",
          invoiceId,
          "Penjualan selesai",
        );
    if (advanceUsed) {
      allocate(prepayment.payment_id, [invoiceId], advanceUsed);
      run(
        "UPDATE payments SET scope=?,version=version+1 WHERE id=?",
        JSON.stringify(
          all(
            "SELECT id FROM invoices WHERE order_id=? ORDER BY rowid",
            orderRow.id,
          ).map((row) => row.id),
        ),
        prepayment.payment_id,
      );
    }
    const newPayment = payment(
      user,
      body,
      [invoiceId],
      orderRow.customer_id,
      "sale",
      tripId ? "delivery" : "counter",
    );
    const paymentId =
      newPayment || (advanceUsed ? prepayment.payment_id : null);
    if (
      tripId &&
      quantitySignature(previousLines) !== quantitySignature(finalItems)
    )
      auditOrderItems(user, orderRow, finalItems, finalDiscounts);
    run(
      "UPDATE orders SET status='done',items=?,discounts=?,current_trip_id=?,version=version+1 WHERE id=?",
      JSON.stringify(finalItems),
      JSON.stringify(finalDiscounts),
      tripId,
      orderRow.id,
    );
    audit(
      user,
      "order.complete",
      orderRow.id,
      { status: orderRow.status },
      { invoiceId, total, paymentId, advanceUsed, partial: false },
    );
    return {
      invoice: invoice(invoiceId),
      paymentId,
      partial: false,
      progress: deliveryProgress(find("orders", orderRow.id)),
    };
  }
  function ownTrip(user, tripId) {
    const trip = find("trips", tripId);
    requireAccess(user, "trips");
    if (!user.owner && trip.courier_id !== user.id)
      fail("Trip ini ditangani kurir lain.", 403);
    return trip;
  }
  function period(query) {
    const from = query.get("from") || dayWib(now()),
      to = query.get("to") || from;
    for (const value of [from, to])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
        fail("Tanggal belum benar.");
    if (from > to) fail("Rentang tanggal belum benar.");
    return {
      from,
      to,
      start: new Date(from + "T00:00:00+07:00").toISOString(),
      end: new Date(
        new Date(to + "T00:00:00+07:00").getTime() + 86400000,
      ).toISOString(),
    };
  }
  function report(user, query, customerId = null) {
    requireAccess(user, "reports");
    const summaryOnly = query.get("view") === "summary";
    const compact = summaryOnly || query.get("view") === "dashboard";
    const { start, end } = period(query),
      params = customerId ? [start, end, customerId] : [start, end],
      condition =
        " WHERE i.recorded_at>=? AND i.recorded_at<?" +
        (customerId ? " AND i.customer_id=?" : "");
    const stats = get(
      "SELECT COUNT(*) count,COALESCE(SUM(net+shipping),0) sales,COALESCE(SUM(shipping),0) shipping,COALESCE(SUM(discount),0) discount FROM invoices i" +
        condition,
      ...params,
    );
    const water = get(
      "SELECT ROUND(COALESCE(SUM((SELECT SUM(COALESCE(json_extract(line.value,'$.capacityLiters'),0)*json_extract(line.value,'$.qty')) FROM json_each(i.items) line)),0),6) liters,COALESCE(SUM(EXISTS(SELECT 1 FROM json_each(i.items) line WHERE json_type(line.value,'$.capacityLiters') IS NULL)),0) legacyInvoices FROM invoices i" +
        condition,
      ...params,
    );
    const rows = compact
      ? []
      : all(
          invoiceQuery +
            condition +
            " ORDER BY i.recorded_at DESC,i.id DESC LIMIT 1000",
          ...params,
        ).map(decodeInvoice);
    const cash = get(
        "SELECT COALESCE(SUM(amount),0) total FROM payments WHERE created_at>=? AND created_at<? AND method='Tunai'",
        start,
        end,
      ).total,
      qris = get(
        "SELECT COALESCE(SUM(amount),0) total FROM payments WHERE created_at>=? AND created_at<? AND method='QRIS'",
        start,
        end,
      ).total;
    const debt = get(
      "SELECT COALESCE(SUM(net+shipping),0)-(SELECT COALESCE(SUM(amount),0) FROM allocations) total FROM invoices",
    ).total;
    const trips = compact
      ? []
      : all(
          "SELECT t.*,u.name courier FROM trips t JOIN users u ON u.id=t.courier_id WHERE t.id IN (SELECT trip_id FROM invoices i" +
            condition +
            " AND trip_id IS NOT NULL)",
          ...params,
        );
    const breakdown = salesBreakdown(db, start, end);
    return {
      stats: { ...stats, cash, qris, debt },
      water,
      ...breakdown,
      funds: cashFundReport(db, start, end),
      receipts: reportReceipts(db, start, end, stats.sales),
      ...cashFlowSummary(db, start, end, breakdown.cashHolders),
      ...(!summaryOnly && user.owner
        ? {
            deliveryPerformance: all(
              `SELECT CASE WHEN EXISTS(SELECT 1 FROM invoices earlier WHERE earlier.order_id=i.order_id AND earlier.rowid<i.rowid) THEN i.id ELSE o.id END id,
                o.id order_id,o.code,o.name,
                CASE WHEN EXISTS(SELECT 1 FROM invoices earlier WHERE earlier.order_id=i.order_id AND earlier.rowid<i.rowid) THEN t.departed_at ELSE o.received_at END received_at,
                i.recorded_at completed_at,u.name courier,
                MAX(0,unixepoch(i.recorded_at)-unixepoch(CASE WHEN EXISTS(SELECT 1 FROM invoices earlier WHERE earlier.order_id=i.order_id AND earlier.rowid<i.rowid) THEN t.departed_at ELSE o.received_at END)) seconds
                 FROM invoices i JOIN orders o ON o.id=i.order_id
                 JOIN trips t ON t.id=i.trip_id JOIN users u ON u.id=t.courier_id` +
                condition +
                " AND o.kind='delivery' AND unixepoch(o.received_at) IS NOT NULL AND unixepoch(i.recorded_at) IS NOT NULL ORDER BY seconds DESC,i.recorded_at DESC,o.id",
              ...params,
            ),
          }
        : {}),
      orderCounts: Object.fromEntries(
        all(
          "SELECT status,COUNT(*) count FROM orders WHERE created_at>=? AND created_at<? GROUP BY status",
          start,
          end,
        ).map((row) => [row.status, row.count]),
      ),
      rows,
      trips,
      truncated: !compact && stats.count > rows.length,
    };
  }
  return {
    now,
    get,
    all,
    run,
    find,
    audit,
    photo,
    items,
    orderDiscounts,
    orderPrepayment,
    deliveryProgress,
    auditOrderItems,
    quantityRevision,
    order,
    complete,
    payment,
    invoice,
    invoiceReceipt,
    transactionCash,
    invoiceQuery,
    ownTrip,
    period,
    report,
    stockMove,
    allocate,
  };
}
