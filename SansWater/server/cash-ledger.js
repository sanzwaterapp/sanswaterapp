import {
  CASH_FUNDS,
  CASH_METHODS,
  inferCashFund,
  inferCategoryFund,
} from "../src/cash-funds.js";
import { hasItemShipping, itemShipping } from "../src/order-pricing.js";
import { isSaleReceipt } from "./sales-breakdown.js";

export function categoryFund(db, categoryId) {
  if (typeof categoryId !== "string") return null;
  const row = db
    .prepare("SELECT fund FROM category_funds WHERE category_id=?")
    .get(categoryId);
  return row
    ? row.fund
    : inferCategoryFund(
        db.prepare("SELECT name FROM categories WHERE id=?").get(categoryId)
          ?.name,
      );
}

export function initializeCategoryFunds(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS category_funds(category_id TEXT PRIMARY KEY REFERENCES categories(id),fund TEXT CHECK(fund IN ('operating','goods','gas')),version INTEGER NOT NULL DEFAULT 1)",
  );
  for (const c of db.prepare("SELECT * FROM categories").all()) {
    const products = db
      .prepare(
        "SELECT p.name,pf.fund FROM products p LEFT JOIN product_funds pf ON pf.product_id=p.id WHERE p.category_id=?",
      )
      .all(c.id);
    const funds = new Set(products.map((p) => p.fund || inferCashFund(p.name)));
    const fund = products.length
      ? funds.size === 1
        ? [...funds][0]
        : null
      : inferCategoryFund(c.name);
    db.prepare(
      "INSERT OR IGNORE INTO category_funds(category_id,fund) VALUES(?,?)",
    ).run(c.id, fund || null);
  }
}

export function listCashFunds(db) {
  return db
    .prepare("SELECT id AS key,name,version FROM cash_funds ORDER BY rowid")
    .all();
}
export function initializeFlexibleFunds(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS cash_funds(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,version INTEGER NOT NULL DEFAULT 1)",
  );
  for (const f of CASH_FUNDS)
    db.prepare("INSERT OR IGNORE INTO cash_funds(id,name) VALUES(?,?)").run(
      f.key,
      f.name,
    );
  db.exec(`ALTER TABLE category_funds RENAME TO category_funds_v8;
    CREATE TABLE category_funds(category_id TEXT PRIMARY KEY REFERENCES categories(id),fund TEXT REFERENCES cash_funds(id),version INTEGER NOT NULL DEFAULT 1);
    INSERT INTO category_funds SELECT * FROM category_funds_v8 ORDER BY rowid;
    DROP TABLE category_funds_v8;
    CREATE INDEX IF NOT EXISTS invoice_trip_period ON invoices(trip_id,recorded_at,id);`);
}

const keys = [...CASH_FUNDS.map((f) => f.key), "unassigned"];
const zero = () => Object.fromEntries(keys.map((key) => [key, 0]));

// Largest remainders, using integer arithmetic: no rupiah can disappear or exceed a remaining balance.
export function proportional(amount, remaining) {
  const keys = Object.keys(remaining);
  const total = Object.values(remaining).reduce((s, n) => s + n, 0);
  if (!amount || !total) return Object.fromEntries(keys.map((key) => [key, 0]));
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > total)
    throw new Error("Alokasi kas melebihi tagihan.");
  const result = Object.fromEntries(keys.map((key) => [key, 0]));
  const ranked = keys
    .map((key) => {
      const numerator = BigInt(amount) * BigInt(remaining[key] || 0);
      result[key] = Number(numerator / BigInt(total));
      return { key, remainder: numerator % BigInt(total) };
    })
    .sort((a, b) =>
      a.remainder === b.remainder
        ? keys.indexOf(a.key) - keys.indexOf(b.key)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let left = amount - Object.values(result).reduce((s, n) => s + n, 0);
  for (const row of ranked)
    if (left > 0 && result[row.key] < (remaining[row.key] || 0)) {
      result[row.key]++;
      left--;
    }
  return result;
}

export function fundSnapshot(items, discounts, shipping) {
  const amounts = zero(),
    unresolved = [];
  const products = new Map();
  for (const line of items) {
    const key = line.productId;
    if (!products.has(key))
      products.set(key, {
        productId: key,
        name: line.name,
        amount: 0,
        shipping: 0,
        fund: Object.hasOwn(line, "fund")
          ? line.fund
          : inferCashFund(line.name),
      });
    products.get(key).amount += line.qty * line.price;
    products.get(key).shipping += line.qty * Number(line.shippingRate || 0);
  }
  for (const row of products.values()) {
    row.amount -= discounts[row.productId] || 0;
    if (hasItemShipping(items)) row.amount += row.shipping;
    const fund =
      typeof row.fund === "string" &&
      /^[a-zA-Z0-9_-]{1,80}$/.test(row.fund) &&
      !["__proto__", "constructor", "prototype"].includes(row.fund)
        ? row.fund
        : "unassigned";
    amounts[fund] = (amounts[fund] || 0) + row.amount;
    if (fund === "unassigned" && row.amount) unresolved.push(row);
  }
  amounts.operating += hasItemShipping(items)
    ? shipping - itemShipping(items)
    : shipping;
  return { amounts, unresolved };
}

export function saveFundSnapshot(db, kind, id, items, discounts, shipping) {
  const snapshot = fundSnapshot(items, discounts, shipping);
  db.prepare(
    "INSERT OR IGNORE INTO transaction_funds(kind,object_id,snapshot) VALUES(?,?,?)",
  ).run(kind, id, JSON.stringify(snapshot));
}

export function initializeCashFunds(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS product_funds(product_id TEXT PRIMARY KEY REFERENCES products(id),fund TEXT CHECK(fund IN ('operating','goods','gas')));
    CREATE TABLE IF NOT EXISTS transaction_funds(kind TEXT NOT NULL,object_id TEXT NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(kind,object_id));
    CREATE TABLE IF NOT EXISTS cash_setup(id INTEGER PRIMARY KEY CHECK(id=1),start_day TEXT NOT NULL,balances TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS cash_entries(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('expense','transfer')),day TEXT NOT NULL,from_fund TEXT NOT NULL,to_fund TEXT,from_method TEXT NOT NULL,to_method TEXT,amount INTEGER NOT NULL CHECK(amount>0),category TEXT NOT NULL,note TEXT NOT NULL,proof_id TEXT REFERENCES photos(id),stock_id TEXT REFERENCES stock_movements(id),from_holder TEXT,to_holder TEXT,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,void_reason TEXT,voided_by TEXT REFERENCES users(id),voided_at TEXT,version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS cash_entry_period ON cash_entries(day,created_at);`);
  for (const p of db.prepare("SELECT id,name FROM products").all()) {
    const fund = inferCashFund(p.name);
    if (fund)
      db.prepare("INSERT OR IGNORE INTO product_funds VALUES(?,?)").run(
        p.id,
        fund,
      );
  }
  for (const row of db
    .prepare("SELECT id,items,discounts,shipping FROM invoices")
    .all())
    saveFundSnapshot(
      db,
      "invoice",
      row.id,
      JSON.parse(row.items),
      JSON.parse(row.discounts),
      row.shipping,
    );
  for (const row of db
    .prepare("SELECT order_id,items,discounts,shipping FROM order_prepayments")
    .all())
    saveFundSnapshot(
      db,
      "prepay",
      row.order_id,
      JSON.parse(row.items),
      JSON.parse(row.discounts),
      row.shipping,
    );
}

// Only unresolved historical values may be explicitly classified. Sealed classifications remain unchanged.
export function resolveFundHistory(db, productId, fund) {
  let resolved = 0;
  for (const row of db
    .prepare(
      "SELECT * FROM transaction_funds WHERE json_array_length(json_extract(snapshot,'$.unresolved'))>0",
    )
    .all()) {
    const snapshot = JSON.parse(row.snapshot),
      keep = [];
    for (const item of snapshot.unresolved) {
      if (item.productId !== productId) {
        keep.push(item);
        continue;
      }
      snapshot.amounts.unassigned -= item.amount;
      snapshot.amounts[fund] = (snapshot.amounts[fund] || 0) + item.amount;
      resolved += item.amount;
    }
    snapshot.unresolved = keep;
    db.prepare(
      "UPDATE transaction_funds SET snapshot=? WHERE kind=? AND object_id=?",
    ).run(JSON.stringify(snapshot), row.kind, row.object_id);
  }
  return resolved;
}

export function cashFundReport(db, start, end) {
  const snapshots = new Map(
    db
      .prepare("SELECT * FROM transaction_funds")
      .all()
      .map((r) => [r.kind + ":" + r.object_id, JSON.parse(r.snapshot)]),
  );
  const funds = listCashFunds(db);
  const keys = [
    ...new Set([
      ...funds.map((f) => f.key),
      "unassigned",
      ...[...snapshots.values()].flatMap((s) => Object.keys(s.amounts)),
    ]),
  ];
  const empty = () => Object.fromEntries(keys.map((key) => [key, 0]));
  const sales = empty();
  const invoices = new Map();
  for (const i of db
    .prepare("SELECT id,items,discounts,shipping,recorded_at FROM invoices")
    .all()) {
    const amounts = (
      snapshots.get("invoice:" + i.id) ||
      fundSnapshot(JSON.parse(i.items), JSON.parse(i.discounts), i.shipping)
    ).amounts;
    invoices.set(i.id, { ...empty(), ...amounts });
    if (i.recorded_at >= start && i.recorded_at < end)
      for (const key of keys) sales[key] += amounts[key] || 0;
  }
  const receiptParts = new Map();
  const payments = db
    .prepare(
      `SELECT p.*,op.order_id,op.items,op.discounts,op.shipping,op.payment_id prepayment,
      (SELECT a.after_json FROM audit a WHERE a.object_id=p.id AND a.action='payment.create' ORDER BY a.created_at,a.id LIMIT 1) metadata,
      EXISTS(SELECT 1 FROM invoices i JOIN audit a ON a.object_id=i.order_id AND a.action='order.complete'
        WHERE i.id=json_extract(p.scope,'$[0]') AND json_extract(a.after_json,'$.paymentId')=p.id) immediate
      FROM payments p LEFT JOIN order_prepayments op ON op.payment_id=p.id ORDER BY p.created_at,p.rowid`,
    )
    .all();
  const allocations = new Map();
  for (const a of db
    .prepare("SELECT * FROM allocations ORDER BY invoice_id")
    .all()) {
    if (!allocations.has(a.payment_id)) allocations.set(a.payment_id, []);
    allocations.get(a.payment_id).push(a);
  }
  for (const p of payments) {
    const parts = empty();
    for (const a of allocations.get(p.id) || []) {
      const remaining = invoices.get(a.invoice_id);
      const split = proportional(a.amount, remaining);
      for (const key of keys) {
        remaining[key] -= split[key];
        parts[key] += split[key];
      }
    }
    if (p.order_id) {
      // A prepayment keeps its original family split before AND after invoice creation.
      const snapshot =
        snapshots.get("prepay:" + p.order_id) ||
        fundSnapshot(JSON.parse(p.items), JSON.parse(p.discounts), p.shipping);
      Object.assign(parts, proportional(p.amount, snapshot.amounts));
    }
    const allocated = Object.values(parts).reduce((s, n) => s + n, 0);
    if (allocated !== p.amount) parts.unassigned += p.amount - allocated;
    receiptParts.set(p.id, parts);
  }
  const day = (value) =>
    new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 10);
  const from = day(start),
    to = day(new Date(Date.parse(end) - 1).toISOString());
  const rows = keys.map((key) => ({
    key,
    name: funds.find((f) => f.key === key)?.name || "Belum dipetakan",
    sales: sales[key],
    sources: Object.fromEntries(
      CASH_METHODS.map((method) => [method, { sales: 0, debt: 0 }]),
    ),
    methods: Object.fromEntries(
      CASH_METHODS.map((method) => [
        method,
        {
          incoming: 0,
          outgoing: 0,
          transferIn: 0,
          transferOut: 0,
          closing: 0,
        },
      ]),
    ),
  }));
  const lookup = Object.fromEntries(rows.map((r) => [r.key, r]));
  function movement(fund, method, date, field, amount) {
    const row = lookup[fund].methods[method];
    if (date >= from && date <= to) row[field] += amount;
  }
  for (const p of payments)
    for (const key of keys) {
      movement(
        key,
        p.method,
        day(p.created_at),
        "incoming",
        receiptParts.get(p.id)[key],
      );
      if (p.created_at >= start && p.created_at < end)
        lookup[key].sources[p.method][isSaleReceipt(p) ? "sales" : "debt"] +=
          receiptParts.get(p.id)[key];
    }
  for (const e of db
    .prepare("SELECT * FROM cash_entries WHERE voided_at IS NULL")
    .all()) {
    movement(
      e.from_fund,
      e.from_method,
      e.day,
      e.kind === "expense" ? "outgoing" : "transferOut",
      e.amount,
    );
    if (e.kind === "transfer")
      movement(e.to_fund, e.to_method, e.day, "transferIn", e.amount);
  }
  for (const row of rows) {
    Object.assign(row, {
      incoming: 0,
      outgoing: 0,
      transferIn: 0,
      transferOut: 0,
      closing: 0,
    });
    for (const m of Object.values(row.methods)) {
      m.closing = m.incoming - m.outgoing + m.transferIn - m.transferOut;
      for (const field of [
        "incoming",
        "outgoing",
        "transferIn",
        "transferOut",
        "closing",
      ])
        if (m[field] !== null) row[field] += m[field];
    }
    row.net = row.incoming - row.outgoing + row.transferIn - row.transferOut;
  }
  const unresolved = [...snapshots.values()]
    .flatMap((s) => s.unresolved)
    .filter(Boolean);
  const unassignedProducts = [
    ...new Map(
      unresolved.map((p) => [p.productId, { id: p.productId, name: p.name }]),
    ).values(),
  ];
  return {
    rows: rows.filter(
      (r) => r.key !== "unassigned" || r.sales || r.incoming || r.closing,
    ),
    unassignedProducts,
  };
}
