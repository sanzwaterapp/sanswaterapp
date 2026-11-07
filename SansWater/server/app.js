import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { openDatabase, transaction, ensureCustomerGroup } from "./database.js";
import { registerCashRoutes } from "./cash-routes.js";
import { registerReportRoutes } from "./report-routes.js";
import { isSaleReceipt } from "./sales-breakdown.js";
import { registerCashFlowRoutes } from "./cash-flow.js";
import { registerWaterControl } from "./water-control.js";
import { createPhotoStorage } from "./photo-storage.js";
import { createChangeFeed } from "./change-feed.js";
import { createSupabaseAuth, authCookie } from "./supabase-auth.js";
import {
  resolveFundHistory,
  categoryFund,
  listCashFunds,
} from "./cash-ledger.js";
import { inferCategoryFund } from "../src/cash-funds.js";
import { hasItemShipping, itemShipping } from "../src/order-pricing.js";
import {
  validDuration,
  validDurationCategories,
} from "../src/duration-settings.js";
import {
  createDomain,
  id,
  hash,
  dayWib,
  has,
  requireAccess,
  fail,
  text,
  integer,
  passwordHash,
  verifyPassword,
  safeUser,
  decodeOrder,
  decodeProduct,
  decodeInvoice,
  PERMISSIONS,
} from "./domain.js";

const displayStatusGroups = {
  active: ["new", "pickup", "fill", "delivery", "failed", "partial"],
  done: ["done"],
  cancel: ["cancel"],
};

function productCapacity(value) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1000000
  )
    fail("Kapasitas harus berupa angka lebih dari 0 sampai 1.000.000 liter.");
  if (Number(value.toFixed(6)) !== value)
    fail("Kapasitas maksimal 6 angka di belakang koma.");
  return value;
}

export function createApp(options = {}) {
  const supabaseAuth = createSupabaseAuth(options.auth);
  const db =
    options.db ||
    openDatabase(
      options.dbPath || process.env.DB_PATH || "./data/depot.sqlite",
    );
  let photoStorage;
  try {
    photoStorage = createPhotoStorage(db, {
      ...options.photoStorage,
      uploadOnCommit: !!options.cloud,
    });
  } catch (error) {
    db.close();
    throw error;
  }
  const d = createDomain(db, options.clock, photoStorage),
    deferredPhoto = Symbol("deferred-photo"),
    routes = [],
    attempts = new Map();
  const route = (method, path, permission, handler) =>
    routes.push({
      method,
      regex: new RegExp(
        "^" + path.replace(/:([A-Za-z]+)/g, "(?<$1>[^/]+)") + "$",
      ),
      permission,
      handler,
    });
  let localRevision = 0;
  const localStore = "local-" + id();
  const localVersion = () => localStore + ":" + localRevision;
  const feed = createChangeFeed({
    probe: options.cloud ? () => options.cloud.probeVersion() : null,
    synchronize: options.cloud
      ? async () => {
          await options.cloud.run(() => {});
          return options.cloud.currentVersion();
        }
      : null,
    day: () => dayWib(d.now()),
    interval: options.syncInterval ?? 15000,
    heartbeat: options.syncHeartbeat ?? 25000,
    maxAge: options.eventsMaxAge ?? 0,
  });
  route("GET", "/api/events", "login", () => ({}));
  route("GET", "/api/sync-version", "login", () => ({}));
  const orderWithPayment = (row) => ({
    ...decodeOrder(row),
    prepayment: d.orderPrepayment(row.id),
    progress: d.deliveryProgress(row),
    revision: d.quantityRevision(row),
  });
  const userByToken = async (req, headers) => {
    const token = authCookie(req, "depot_session");
    if (!token) return null;
    const row = d.get(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
      hash(token),
      d.now(),
    );
    if (!row) return null;
    if (!supabaseAuth) return safeUser(row);
    const verified = await supabaseAuth.verify(req);
    if (!verified || verified.user.app_metadata?.depot_user_id !== row.id) {
      d.run("DELETE FROM sessions WHERE token_hash=?", hash(token));
      headers["Set-Cookie"] = [
        cookie("", true),
        ...supabaseAuth.clearCookies(),
      ];
      return null;
    }
    // Recheck after the remote request: staff may have been disabled or logged out meanwhile.
    const current = d.get(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
      hash(token),
      d.now(),
    );
    if (!current) return null;
    if (verified.session)
      headers["Set-Cookie"] = supabaseAuth.cookies(verified.session);
    return safeUser(current);
  };
  const cookie = (token, expire = false) =>
    `depot_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expire ? 0 : 43200}${process.env.SECURE_COOKIE === "true" ? "; Secure" : ""}`;
  function authenticate(user) {
    const token = randomBytes(32).toString("hex");
    d.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hash(token),
      user.id,
      new Date(new Date(d.now()).getTime() + 43200000).toISOString(),
    );
    return token;
  }
  function perms(value, role) {
    if (!Array.isArray(value) || value.some((p) => !PERMISSIONS.includes(p)))
      fail("Daftar akses belum benar.");
    if (role !== undefined && !["staff", "manager"].includes(role))
      fail("Peran akun belum benar.");
    const permissions = new Set(value);
    if (role === "manager") permissions.add("reports");
    if (role === "staff") permissions.delete("reports");
    return JSON.stringify([...permissions]);
  }
  const username = (value) => {
    const v = text(value, "Username", 40).toLowerCase();
    if (!/^[a-z0-9_.-]{3,40}$/.test(v))
      fail("Username minimal 3 karakter: huruf, angka, titik atau garis.");
    return v;
  };
  function updateAccountProfile(ctx, previous) {
    const b = ctx.body;
    if (
      (b.expectedName !== undefined && b.expectedName !== previous.name) ||
      (b.expectedUsername !== undefined &&
        b.expectedUsername !== previous.username)
    )
      fail("Akun sudah berubah. Muat ulang sebelum menyimpan.", 409);
    const name = text(b.name, "Nama akun"),
      loginName =
        b.username === undefined ? previous.username : username(b.username);
    d.run(
      "UPDATE users SET name=?,username=? WHERE id=?",
      name,
      loginName,
      previous.id,
    );
    const updated = safeUser(d.find("users", previous.id));
    d.audit(
      ctx.user,
      "account.update",
      previous.id,
      safeUser(previous),
      updated,
    );
    return { user: updated };
  }
  function changeOwnPassword(ctx, user) {
    if (supabaseAuth)
      fail("Kata sandi akun ini dikelola melalui Supabase Auth.", 409);
    d.run(
      "UPDATE users SET password_hash=? WHERE id=?",
      passwordHash(ctx.body.password),
      user.id,
    );
    d.run("DELETE FROM sessions WHERE user_id=?", user.id);
    ctx.headers["Set-Cookie"] = cookie(authenticate(safeUser(user)));
    d.audit(ctx.user, "password.change", user.id, null, null);
    return { ok: true };
  }
  route("GET", "/api/health", null, async () => {
    await options.cloud?.health();
    return { ok: true, dataProvider: options.cloud ? "supabase" : "sqlite" };
  });
  route("GET", "/api/session", null, (ctx) => ({
    user: ctx.user,
    needsSetup: !supabaseAuth && !d.get("SELECT id FROM users LIMIT 1"),
    authProvider: supabaseAuth ? "supabase" : "local",
    today: dayWib(d.now()),
    now: d.now(),
  }));
  route("POST", "/api/setup", null, (ctx) => {
    if (options.allowSetup === false)
      fail("Setup owner tidak tersedia melalui deployment publik.", 403);
    if (supabaseAuth)
      fail(
        "Siapkan dan tautkan owner sebelum mengaktifkan Supabase Auth.",
        403,
      );
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        ctx.req.socket.remoteAddress,
      )
    )
      fail("Pengaturan owner pertama dilakukan dari komputer server.", 403);
    return transaction(db, () => {
      if (d.get("SELECT id FROM users LIMIT 1"))
        fail("Owner sudah dibuat.", 409);
      const userId = id(),
        b = ctx.body;
      d.run(
        "INSERT INTO users VALUES(?,?,?,?,?,?,?,?)",
        userId,
        username(b.username),
        text(b.name, "Nama owner"),
        passwordHash(b.password),
        1,
        1,
        "[]",
        d.now(),
      );
      d.run(
        "INSERT INTO settings VALUES(?,?)",
        "name",
        text(b.depotName, "Nama depot"),
      );
      const user = safeUser(d.find("users", userId));
      ctx.headers["Set-Cookie"] = cookie(authenticate(user));
      return { user };
    });
  });
  route("POST", "/api/login", null, async (ctx) => {
    if (!supabaseAuth) username(ctx.body.username);
    text(ctx.body.password, "Kata sandi", 200);
    const key =
        ctx.req.socket.remoteAddress +
        ":" +
        String(supabaseAuth ? ctx.body.email : ctx.body.username).toLowerCase(),
      limit = attempts.get(key) || { count: 0, until: 0 };
    if (limit.until > Date.now() && limit.count >= 10)
      fail("Terlalu banyak percobaan. Coba kembali dalam 15 menit.", 429);
    if (limit.until <= Date.now()) {
      limit.count = 0;
      limit.until = Date.now() + 900000;
    }
    limit.count++;
    attempts.set(key, limit);
    if (attempts.size > 10000)
      for (const [k, v] of attempts)
        if (v.until < Date.now()) attempts.delete(k);
    if (supabaseAuth) {
      const result = await supabaseAuth.signIn(
        ctx.body.email,
        ctx.body.password,
      );
      const localId = result.user.app_metadata?.depot_user_id;
      const row =
        typeof localId === "string"
          ? d.get("SELECT * FROM users WHERE id=? AND active=1", localId)
          : null;
      if (!row)
        fail(
          "Akun Supabase belum ditautkan ke akun depot yang aktif. Hubungi owner.",
          403,
        );
      attempts.delete(key);
      const user = safeUser(row);
      ctx.headers["Set-Cookie"] = [
        cookie(authenticate(user)),
        ...supabaseAuth.cookies(result.session),
      ];
      return { user };
    }
    const row = d.get(
      "SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1",
      String(ctx.body.username || ""),
    );
    if (!row || !verifyPassword(ctx.body.password || "", row.password_hash))
      fail("Username atau kata sandi belum benar.", 401);
    attempts.delete(key);
    const user = safeUser(row);
    ctx.headers["Set-Cookie"] = cookie(authenticate(user));
    return { user };
  });
  route("POST", "/api/logout", null, async (ctx) => {
    const token = ctx.req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("depot_session="))
      ?.slice(14);
    if (token) d.run("DELETE FROM sessions WHERE token_hash=?", hash(token));
    ctx.headers["Set-Cookie"] = supabaseAuth
      ? [cookie("", true), ...supabaseAuth.clearCookies()]
      : cookie("", true);
    if (supabaseAuth) await supabaseAuth.signOut(ctx.req);
    return { ok: true };
  });
  route("GET", "/api/state", "login", (ctx) => {
    const u = ctx.user,
      operational = [
        "orders",
        "trips",
        "counter",
        "customers",
        "debts",
        "reports",
      ].some((p) => has(u, p)),
      today = dayWib(d.now()),
      since = new Date(
        new Date(d.now()).getTime() - 90 * 86400000,
      ).toISOString();
    const orders = operational
      ? d
          .all(
            "SELECT o.*,u.name courier FROM orders o LEFT JOIN trips t ON t.id=o.current_trip_id LEFT JOIN users u ON u.id=t.courier_id WHERE o.status NOT IN ('done','cancel') OR o.id IN (SELECT id FROM orders WHERE status IN ('done','cancel') AND created_at>=? ORDER BY created_at DESC LIMIT 200) ORDER BY o.received_at ASC",
            since,
          )
          .map(orderWithPayment)
      : [];
    const trips = has(u, "trips")
      ? d
          .all(
            "SELECT t.*,u.name courier FROM trips t JOIN users u ON u.id=t.courier_id WHERE (t.closed_at IS NULL OR t.id IN (SELECT id FROM trips WHERE closed_at IS NOT NULL AND departed_at>=? AND (courier_id=? OR ?=1) ORDER BY departed_at DESC LIMIT 100)) AND (t.courier_id=? OR ?=1) ORDER BY t.departed_at DESC",
            since,
            u.id,
            u.owner ? 1 : 0,
            u.id,
            u.owner ? 1 : 0,
          )
          .map((t) => ({
            ...t,
            orders: d
              .all(
                "SELECT x.*,o.name,o.code,i.id invoice_id,i.net+i.shipping total FROM trip_orders x JOIN orders o ON o.id=x.order_id LEFT JOIN invoices i ON i.order_id=o.id AND i.trip_id=x.trip_id WHERE x.trip_id=?",
                t.id,
              )
              .map((r) => ({
                ...r,
                items: JSON.parse(r.items),
                revision: d.quantityRevision(
                  d.find("orders", r.order_id),
                  r.outcome === "delivery" ? null : r.recorded_at,
                ),
              })),
          }))
      : [];
    const attendance = has(u, "attendanceView")
      ? d.all(
          "SELECT a.*,u.name FROM attendance a JOIN users u ON u.id=a.user_id WHERE day=? ORDER BY created_at",
          today,
        )
      : d.all(
          "SELECT a.*,u.name FROM attendance a JOIN users u ON u.id=a.user_id WHERE day=? AND user_id=?",
          today,
          u.id,
        );
    const debts =
      has(u, "debts") || has(u, "reports")
        ? d.all(
            `SELECT c.id,c.code,c.name,SUM(i.net+i.shipping-COALESCE(a.paid,0)) total,COUNT(*) count FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN (SELECT invoice_id,SUM(amount) paid FROM allocations GROUP BY invoice_id) a ON a.invoice_id=i.id WHERE i.net+i.shipping>COALESCE(a.paid,0) GROUP BY c.id ORDER BY total DESC`,
          )
        : [];
    return {
      user: u,
      authProvider: supabaseAuth ? "supabase" : "local",
      simulation:
        d.get("SELECT value FROM settings WHERE key='simulation'")?.value ===
        "1",
      settings: Object.fromEntries(
        d
          .all("SELECT * FROM settings WHERE key NOT LIKE 'payroll.%'")
          .map((r) => [r.key, r.value]),
      ),
      today,
      nextTripNumber: has(u, "trips")
        ? d.get(
            "SELECT COALESCE(MAX(number),0)+1 number FROM trips WHERE day=?",
            today,
          ).number
        : null,
      now: d.now(),
      permissions: PERMISSIONS,
      cashFunds: listCashFunds(db),
      categories:
        operational || has(u, "catalog")
          ? d.all("SELECT * FROM categories ORDER BY rowid").map((c) => ({
              ...c,
              fund: categoryFund(db, c.id),
              version:
                d.get(
                  "SELECT version FROM category_funds WHERE category_id=?",
                  c.id,
                )?.version || 0,
            }))
          : [],
      products:
        operational || has(u, "catalog") || has(u, "stock")
          ? d
              .all(
                "SELECT * FROM products WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='productArchived:'||products.id) ORDER BY rowid",
              )
              .map((p) => ({
                ...decodeProduct(p),
                fund: categoryFund(db, p.category_id),
              }))
          : [],
      archivedProducts:
        operational || has(u, "catalog") || has(u, "stock")
          ? d
              .all(
                "SELECT * FROM products WHERE EXISTS (SELECT 1 FROM settings WHERE key='productArchived:'||products.id) ORDER BY rowid",
              )
              .map((p) => ({
                ...decodeProduct(p),
                fund: categoryFund(db, p.category_id),
              }))
          : [],
      customers: operational
        ? d.all(
            "SELECT c.*,EXISTS(SELECT 1 FROM settings s WHERE s.key='customer.archived:'||c.id) archived FROM customers c ORDER BY c.code COLLATE NOCASE LIMIT 2000",
          )
        : [],
      customerGroups: operational
        ? d.all(
            "SELECT prefix,name FROM customer_groups ORDER BY prefix COLLATE NOCASE",
          )
        : [],
      orders,
      dailyCounts: operational
        ? Object.fromEntries(
            d
              .all(
                "SELECT status,COUNT(*) count FROM orders WHERE created_at>=? AND created_at<? GROUP BY status",
                new Date(today + "T00:00:00+07:00").toISOString(),
                new Date(
                  new Date(today + "T00:00:00+07:00").getTime() + 86400000,
                ).toISOString(),
              )
              .map((r) => [r.status, r.count]),
          )
        : {},
      trips,
      attendance,
      debts,
      staff: has(u, "staff")
        ? d
            .all(
              "SELECT * FROM users WHERE id NOT IN (SELECT substr(key,15) FROM settings WHERE key LIKE 'staffArchived:%') ORDER BY name",
            )
            .map(safeUser)
        : [],
      limits: {
        orders:
          orders.filter((o) => ["done", "cancel"].includes(o.status)).length >=
          200,
        customers:
          operational && d.get("SELECT COUNT(*) n FROM customers").n > 2000,
      },
    };
  });
  route("GET", "/api/display", "display", (ctx) => {
    const filter = ctx.query.get("filter") || "active";
    if (!Object.hasOwn(displayStatusGroups, filter))
      fail("Filter TV belum benar.");
    const active = filter === "active";
    const states = displayStatusGroups[filter];
    const status = "o.status IN (" + states.map(() => "?").join(",") + ")";
    const today = dayWib(d.now());
    const args = [...states];
    if (!active) {
      const start = today + "T00:00:00+07:00";
      args.push(start, new Date(Date.parse(start) + 86400000).toISOString());
    }
    // All unfinished days remain visible; closed lists are limited to today's activity.
    return {
      now: d.now(),
      orders: d
        .all(
          "SELECT o.*,u.name courier FROM orders o LEFT JOIN trips t ON t.id=o.current_trip_id LEFT JOIN users u ON u.id=t.courier_id WHERE o.kind='delivery' AND " +
            status +
            (active
              ? ""
              : " AND datetime(COALESCE((SELECT max(i.recorded_at) FROM invoices i WHERE i.order_id=o.id),(SELECT max(a.created_at) FROM audit a WHERE a.object_id=o.id AND a.action IN ('order.status','trip.result')),o.created_at))>=datetime(?) AND datetime(COALESCE((SELECT max(i.recorded_at) FROM invoices i WHERE i.order_id=o.id),(SELECT max(a.created_at) FROM audit a WHERE a.object_id=o.id AND a.action IN ('order.status','trip.result')),o.created_at))<datetime(?)") +
            " ORDER BY datetime(o.received_at) ASC,datetime(o.created_at) ASC,o.rowid ASC",
          ...args,
        )
        .map(orderWithPayment),
    };
  });
  route("POST", "/api/categories", "catalog", (ctx) => {
    const fund = ctx.body.fund || inferCategoryFund(ctx.body.name);
    if (
      typeof fund !== "string" ||
      !d.get("SELECT id FROM cash_funds WHERE id=?", fund)
    )
      fail("Pilih kas untuk kategori produk.");
    const categoryId = id();
    d.run(
      "INSERT INTO categories VALUES(?,?)",
      categoryId,
      text(ctx.body.name, "Nama kategori", 60),
    );
    d.run(
      "INSERT INTO category_funds(category_id,fund) VALUES(?,?)",
      categoryId,
      fund,
    );
    d.audit(ctx.user, "category.create", categoryId, null, {
      ...ctx.body,
      fund,
    });
    return { id: categoryId };
  });
  route("PATCH", "/api/categories/:id", "catalog", (ctx) => {
    const c = d.find("categories", ctx.params.id),
      previous = {
        ...c,
        fund: categoryFund(db, c.id),
        version:
          d.get("SELECT version FROM category_funds WHERE category_id=?", c.id)
            ?.version || 0,
      },
      b = ctx.body;
    if (b.version !== previous.version)
      fail("Kategori sudah diubah. Muat ulang.", 409);
    if (
      b.fund !== null &&
      (typeof b.fund !== "string" ||
        !d.get("SELECT id FROM cash_funds WHERE id=?", b.fund))
    )
      fail("Pilih kas kategori.");
    const name =
      b.name === undefined ? c.name : text(b.name, "Nama kategori", 60);
    d.run("UPDATE categories SET name=? WHERE id=?", name, c.id);
    d.run(
      "INSERT INTO category_funds(category_id,fund,version) VALUES(?,?,1) ON CONFLICT(category_id) DO UPDATE SET fund=excluded.fund,version=category_funds.version+1",
      c.id,
      b.fund,
    );
    d.run("UPDATE products SET version=version+1 WHERE category_id=?", c.id);
    for (const p of d.all(
      "SELECT id FROM products WHERE category_id=?",
      c.id,
    )) {
      const resolved = b.fund ? resolveFundHistory(db, p.id, b.fund) : 0;
      if (resolved)
        d.audit(ctx.user, "cash.classify", p.id, null, {
          categoryId: c.id,
          fund: b.fund,
          snapshotValue: resolved,
        });
    }
    d.audit(ctx.user, "category.update", c.id, previous, {
      name,
      fund: b.fund,
    });
    return { ok: true };
  });
  route("DELETE", "/api/categories/:id", "catalog", (ctx) => {
    const category = d.find("categories", ctx.params.id);
    const mapping = d.get(
      "SELECT fund,version FROM category_funds WHERE category_id=?",
      category.id,
    );
    if (ctx.body.version !== (mapping?.version || 0))
      fail("Kategori sudah diubah. Muat ulang.", 409);
    if (
      d.get("SELECT id FROM products WHERE category_id=? LIMIT 1", category.id)
    )
      fail(
        "Pindahkan semua produk kategori ini terlebih dahulu, termasuk produk arsip.",
        409,
      );
    d.run("DELETE FROM category_funds WHERE category_id=?", category.id);
    d.run("DELETE FROM categories WHERE id=?", category.id);
    d.audit(
      ctx.user,
      "category.delete",
      category.id,
      { ...category, ...mapping },
      null,
    );
    return { ok: true };
  });
  route("POST", "/api/products", "catalog", (ctx) => {
    const b = ctx.body;
    const capacity = productCapacity(b.capacityLiters);
    const fund = categoryFund(db, b.categoryId);
    if (
      typeof fund !== "string" ||
      !d.get("SELECT id FROM cash_funds WHERE id=?", fund)
    )
      fail("Kategori produk belum dikaitkan ke kas.");
    d.find("categories", b.categoryId);
    if (typeof b.tracked !== "boolean") fail("Pilih pengaturan stok.");
    if (!Array.isArray(b.modes) || !b.modes.length || b.modes.length > 10)
      fail("Isi harga produk.");
    const modes = b.modes.map((m) => ({
        id: id(),
        name: text(m.name, "Cara beli", 60),
        price: integer(m.price, "Harga"),
      })),
      productId = id();
    d.run(
      "INSERT INTO products(id,name,category_id,tracked,stock,modes,version,capacity_liters) VALUES(?,?,?,?,?,?,?,?)",
      productId,
      text(b.name, "Nama produk"),
      b.categoryId,
      b.tracked ? 1 : 0,
      0,
      JSON.stringify(modes),
      1,
      capacity,
    );
    d.audit(ctx.user, "product.create", productId, null, { ...b, modes });
    return { id: productId };
  });
  route("PATCH", "/api/products/:id", "catalog", (ctx) => {
    const p = d.find("products", ctx.params.id),
      b = ctx.body;
    if (
      d.get("SELECT value FROM settings WHERE key=?", "productArchived:" + p.id)
    )
      fail("Pulihkan produk sebelum mengubahnya.", 409);
    if (p.version !== b.version)
      fail("Produk sudah diubah pengguna lain. Muat ulang.", 409);
    const capacity = Object.hasOwn(b, "capacityLiters")
      ? productCapacity(b.capacityLiters)
      : p.capacity_liters;
    d.find("categories", b.categoryId);
    const fund = categoryFund(db, b.categoryId);
    if (
      typeof fund !== "string" ||
      !d.get("SELECT id FROM cash_funds WHERE id=?", fund)
    )
      fail("Kategori produk belum dikaitkan ke kas.");
    if (typeof b.tracked !== "boolean") fail("Pilih mode stok.");
    if (!Array.isArray(b.modes) || !b.modes.length || b.modes.length > 10)
      fail("Isi harga produk.");
    const old = JSON.parse(p.modes),
      seen = new Set();
    const modes = b.modes.map((m) => {
      const modeId = old.some((o) => o.id === m.id) ? m.id : id();
      if (seen.has(modeId)) fail("Cara beli ganda.");
      seen.add(modeId);
      return {
        id: modeId,
        name: text(m.name, "Cara beli", 60),
        price: integer(m.price, "Harga"),
      };
    });
    if (!p.tracked && b.tracked) {
      const actual = integer(b.actualStock, "Saldo fisik", -1000000, 1000000);
      d.stockMove(
        ctx.user,
        p.id,
        actual - p.stock,
        "reconcile",
        null,
        text(b.stockReason, "Catatan saldo fisik"),
      );
    }
    d.run(
      "UPDATE products SET name=?,category_id=?,tracked=?,modes=?,capacity_liters=?,version=version+1 WHERE id=?",
      text(b.name, "Nama produk"),
      b.categoryId,
      b.tracked ? 1 : 0,
      JSON.stringify(modes),
      capacity,
      p.id,
    );
    d.audit(
      ctx.user,
      "product.update",
      p.id,
      { ...p, modes: old },
      { ...b, modes },
    );
    const resolved = resolveFundHistory(db, p.id, fund);
    if (resolved)
      d.audit(ctx.user, "cash.classify", p.id, null, {
        fund,
        amount: resolved,
      });
    return { ok: true };
  });
  for (const [method, suffix, archived] of [
    ["DELETE", "", true],
    ["POST", "/restore", false],
  ]) {
    route(method, "/api/products/:id" + suffix, "catalog", (ctx) => {
      const p = d.find("products", ctx.params.id);
      if (p.version !== ctx.body.version)
        fail("Produk sudah berubah. Muat ulang.", 409);
      const key = "productArchived:" + p.id;
      const previous = !!d.get("SELECT value FROM settings WHERE key=?", key);
      if (previous === archived) return { ok: true };
      if (archived) d.run("INSERT INTO settings VALUES(?,?)", key, d.now());
      else d.run("DELETE FROM settings WHERE key=?", key);
      d.run("UPDATE products SET version=version+1 WHERE id=?", p.id);
      d.audit(
        ctx.user,
        archived ? "product.archive" : "product.restore",
        p.id,
        { archived: previous },
        { archived },
      );
      return { ok: true };
    });
  }
  route("POST", "/api/products/:id/stock", "stock", (ctx) => {
    const p = d.find("products", ctx.params.id);
    if (
      d.get("SELECT value FROM settings WHERE key=?", "productArchived:" + p.id)
    )
      fail("Pulihkan produk sebelum menambah stok.", 409);
    if (!p.tracked) fail("Produk ini memakai stok tanpa batas.");
    const qty = integer(ctx.body.qty, "Stok masuk", 1, 1000000);
    d.stockMove(
      ctx.user,
      p.id,
      qty,
      "in",
      null,
      text(ctx.body.note, "Catatan stok"),
    );
    d.audit(
      ctx.user,
      "stock.in",
      p.id,
      { stock: p.stock },
      { qty, note: ctx.body.note },
    );
    return { ok: true };
  });
  route("GET", "/api/stock-history", "login", (ctx) => {
    if (!has(ctx.user, "stock") && !has(ctx.user, "reports"))
      fail("Akun ini tidak memiliki akses.", 403);
    const paged = ctx.query.get("paged") === "1";
    const direction = ctx.query.get("direction") || "all";
    if (!["all", "in", "out", "reconcile"].includes(direction))
      fail("Pilih jenis pergerakan stok.");
    let condition = " WHERE 1=1";
    const params = [];
    if (ctx.query.get("period") !== "all" && (paged || ctx.query.has("from"))) {
      const { start, end } = d.period(ctx.query);
      condition += " AND s.created_at>=? AND s.created_at<?";
      params.push(start, end);
    }
    if (direction !== "all") {
      condition +=
        " AND " +
        { in: "s.qty>0", out: "s.qty<0", reconcile: "s.kind='reconcile'" }[
          direction
        ];
    }
    const search = (ctx.query.get("search") || "").trim();
    if (search.length > 100) fail("Pencarian maksimal 100 karakter.");
    if (search) {
      condition += " AND (p.name LIKE ? OR u.name LIKE ? OR u.username LIKE ?)";
      params.push(...Array(3).fill("%" + search + "%"));
    }
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman riwayat",
      0,
      10000000,
    );
    const source =
      " FROM stock_movements s JOIN products p ON p.id=s.product_id JOIN users u ON u.id=s.actor_id";
    const rows = d.all(
      "SELECT s.*,p.name product,u.name actor,u.username actor_username" +
        source +
        condition +
        " ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?",
      ...params,
      paged ? 30 : 200,
      offset,
    );
    if (!paged) return rows;
    const { total } = d.get(
      "SELECT COUNT(*) total" + source + condition,
      ...params,
    );
    return { rows, total, offset, hasMore: offset + rows.length < total };
  });
  route("POST", "/api/customer-groups", "customers", (ctx) => {
    const prefix = text(ctx.body.prefix, "Awalan kode", 8).toUpperCase();
    if (!/^[A-Z]{1,8}$/.test(prefix))
      fail("Awalan kode hanya berisi huruf A–Z.");
    const name = text(ctx.body.name, "Nama kelompok", 60);
    if (d.get("SELECT prefix FROM customer_groups WHERE prefix=?", prefix))
      fail("Awalan kode sudah dipakai kelompok lain.", 409);
    d.run(
      "INSERT INTO customer_groups(prefix,name,created_at) VALUES(?,?,?)",
      prefix,
      name,
      d.now(),
    );
    d.audit(ctx.user, "customer-group.create", prefix, null, { prefix, name });
    return { prefix, name };
  });
  route("GET", "/api/customer-code", "customers", (ctx) => {
    const prefix = text(
      ctx.query.get("prefix") || "A",
      "Awalan kode",
      10,
    ).toUpperCase();
    if (!/^[A-Z]+$/.test(prefix)) fail("Awalan kode berupa huruf.");
    const nums = d
      .all("SELECT code FROM customers WHERE code LIKE ?", prefix + "%")
      .map((c) => c.code.match(new RegExp("^" + prefix + "(\\d+)$")))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    const used = new Set(nums);
    let next = 1;
    while (used.has(next)) next++;
    return { suggested: prefix + next };
  });
  route("PATCH", "/api/customer-groups/:prefix", "customers", (ctx) => {
    const previous = d.get(
      "SELECT prefix,name FROM customer_groups WHERE prefix=?",
      ctx.params.prefix,
    );
    if (!previous) fail("Kelompok tidak ditemukan.", 404);
    const name = text(ctx.body.name, "Nama kelompok", 60);
    d.run(
      "UPDATE customer_groups SET name=? WHERE prefix=?",
      name,
      previous.prefix,
    );
    d.audit(ctx.user, "customer-group.update", previous.prefix, previous, {
      ...previous,
      name,
    });
    return { ...previous, name };
  });
  route("DELETE", "/api/customer-groups/:prefix", "customers", (ctx) => {
    const previous = d.get(
      "SELECT prefix,name FROM customer_groups WHERE prefix=?",
      ctx.params.prefix,
    );
    if (!previous) fail("Kelompok tidak ditemukan.", 404);
    const members = d.all(
      "SELECT id,code FROM customers WHERE group_prefix=?",
      previous.prefix,
    );
    let destination = null;
    if (members.length) {
      const moveTo = text(ctx.body.moveTo, "Kelompok tujuan", 8).toUpperCase();
      destination = d.get(
        "SELECT prefix,name FROM customer_groups WHERE prefix=?",
        moveTo,
      );
      if (!destination || destination.prefix === previous.prefix)
        fail("Pilih kelompok lain untuk memindahkan pelanggan.");
      d.run(
        "UPDATE customers SET group_prefix=? WHERE group_prefix=?",
        destination.prefix,
        previous.prefix,
      );
    }
    d.run("DELETE FROM customer_groups WHERE prefix=?", previous.prefix);
    d.audit(
      ctx.user,
      "customer-group.delete",
      previous.prefix,
      { ...previous, members },
      {
        movedTo: destination?.prefix || null,
        moved: members.length,
      },
    );
    return {
      ok: true,
      moved: members.length,
      movedTo: destination?.prefix || null,
    };
  });
  function customerData(body, previous) {
    const code = text(body.code, "Kode pelanggan", 30).toUpperCase();
    if (!/^[A-Z]+[0-9]+$/.test(code))
      fail("Kode berupa huruf dan nomor, misalnya A13.");
    const wa = text(body.whatsapp, "Nomor WhatsApp", 25);
    if (!/^\+?[0-9 -]{7,25}$/.test(wa)) fail("Nomor WhatsApp belum benar.");
    const explicitGroup = body.groupPrefix ?? body.group_prefix;
    const groupPrefix = text(
      explicitGroup ?? previous?.group_prefix ?? code.match(/^[A-Z]+/)[0],
      "Kelompok pelanggan",
      30,
    ).toUpperCase();
    if (!previous && groupPrefix === code.match(/^[A-Z]+/)[0])
      ensureCustomerGroup(db, code, d.now());
    if (
      !d.get("SELECT prefix FROM customer_groups WHERE prefix=?", groupPrefix)
    )
      fail("Kelompok pelanggan tidak ditemukan.");
    return {
      code,
      groupPrefix,
      name: text(body.name, "Nama pelanggan"),
      wa,
      location:
        typeof body.location === "string" ? body.location.slice(0, 300) : "",
    };
  }
  route("POST", "/api/customers", "customers", (ctx) => {
    const c = customerData(ctx.body),
      customerId = id(),
      photoId = ctx.body.photo
        ? d.photo(ctx.user, ctx.body.photo, "house")
        : null;
    d.run(
      "INSERT INTO customers(id,code,name,whatsapp,location,photo_id,created_at,group_prefix) VALUES(?,?,?,?,?,?,?,?)",
      customerId,
      c.code,
      c.name,
      c.wa,
      c.location,
      photoId,
      d.now(),
      c.groupPrefix,
    );
    d.audit(ctx.user, "customer.create", customerId, null, c);
    return { id: customerId };
  });
  route("PATCH", "/api/customers/:id", "customers", (ctx) => {
    const previous = d.find("customers", ctx.params.id),
      c = customerData(ctx.body, previous),
      photoId = ctx.body.photo
        ? d.photo(ctx.user, ctx.body.photo, "house")
        : previous.photo_id;
    d.run(
      "UPDATE customers SET code=?,name=?,whatsapp=?,location=?,photo_id=?,group_prefix=? WHERE id=?",
      c.code,
      c.name,
      c.wa,
      c.location,
      photoId,
      c.groupPrefix,
      previous.id,
    );
    d.audit(ctx.user, "customer.update", previous.id, previous, c);
    return { ok: true };
  });
  route("DELETE", "/api/customers/:id", "customers", (ctx) => {
    const customer = d.find("customers", ctx.params.id);
    if (ctx.body.confirmed !== true)
      fail("Konfirmasi penghapusan pelanggan terlebih dahulu.");
    d.run(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING",
      "customer.archived:" + customer.id,
      d.now(),
    );
    d.audit(ctx.user, "customer.archive", customer.id, customer, {
      archived: true,
    });
    return { ok: true };
  });
  route("POST", "/api/customers/:id/restore", "customers", (ctx) => {
    const customer = d.find("customers", ctx.params.id);
    d.run(
      "DELETE FROM settings WHERE key=?",
      "customer.archived:" + customer.id,
    );
    d.audit(
      ctx.user,
      "customer.restore",
      customer.id,
      { archived: true },
      customer,
    );
    return { ok: true };
  });
  route("POST", "/api/orders", "orders", (ctx) => {
    const order = d.order(ctx.user, ctx.body);
    return orderWithPayment(d.find("orders", order.id));
  });
  route("PATCH", "/api/orders/:id/items", "login", (ctx) => {
    const row = d.find("orders", ctx.params.id);
    if (!has(ctx.user, "orders")) {
      if (row.status !== "delivery")
        fail("Akun ini tidak memiliki akses.", 403);
      d.ownTrip(ctx.user, row.current_trip_id);
    }
    const progress = d.deliveryProgress(row),
      advance = d.orderPrepayment(row.id);
    if (row.version !== ctx.body.version)
      fail("Pesanan sudah berubah. Tutup lalu buka kembali isian produk.", 409);
    if (
      row.kind !== "delivery" ||
      !["new", "pickup", "fill", "failed", "partial", "delivery"].includes(
        row.status,
      )
    )
      fail("Pesanan selesai atau batal tidak dapat diubah.", 409);
    let lines = d.items(
      ctx.body.items,
      false,
      !(advance?.amount > 0),
      JSON.parse(row.items).map((line) => line.productId),
    );
    lines = lines.map((line) => {
      const previous = JSON.parse(row.items).find(
        (old) => old.productId === line.productId && old.modeId === line.modeId,
      );
      return line.shippingRate === undefined &&
        previous?.shippingRate !== undefined
        ? { ...line, shippingRate: previous.shippingRate }
        : line;
    });
    if (advance?.amount > 0) {
      const previous = new Map(
        JSON.parse(row.items).map((line) => [
          line.productId + ":" + line.modeId,
          line,
        ]),
      );
      for (const line of lines) {
        const old = previous.get(line.productId + ":" + line.modeId);
        if (!advance.itemShipping && (line.shippingRate || 0) > 0)
          fail("Ongkir mengikuti pembayaran awal pesanan ini.", 409);
        if (old) {
          line.price = old.price;
          if ((line.shippingRate || 0) !== (old.shippingRate || 0))
            fail("Ongkir per unit mengikuti pesanan yang sudah dibayar.", 409);
        }
      }
    }
    for (const delivered of progress.deliveredItems) {
      const planned = lines.find(
        (line) =>
          line.productId === delivered.productId &&
          line.modeId === delivered.modeId,
      );
      if (!planned || planned.qty < delivered.qty)
        fail(
          "Jumlah pesanan tidak boleh kurang dari jumlah yang sudah diserahkan.",
          409,
        );
    }
    const discounts = d.orderDiscounts(
      lines,
      ctx.body.discounts ??
        Object.fromEntries(
          Object.entries(JSON.parse(row.discounts || "{}")).filter(([key]) =>
            lines.some((line) => line.productId === key),
          ),
        ),
      JSON.parse(row.discounts || "{}"),
    );
    if (
      Object.entries(progress.usedDiscounts).some(
        ([key, value]) => (discounts[key] || 0) < value,
      )
    )
      fail(
        "Diskon tidak boleh kurang dari diskon pada pengantaran sebelumnya.",
        409,
      );
    const revisedTotal =
      lines.reduce((sum, line) => sum + line.qty * line.price, 0) -
      Object.values(discounts).reduce((sum, value) => sum + value, 0) +
      (hasItemShipping(lines) && (!advance || advance.itemShipping)
        ? itemShipping(lines)
        : advance?.shipping || 0);
    if (advance && revisedTotal < advance.amount)
      fail(
        "Jumlah baru menimbulkan kelebihan pembayaran. Selesaikan koreksi pembayaran terlebih dahulu.",
        409,
      );
    d.run(
      "UPDATE orders SET items=?,discounts=?,version=version+1 WHERE id=?",
      JSON.stringify(lines),
      JSON.stringify(discounts),
      row.id,
    );
    const updatedProgress = d.deliveryProgress(d.find("orders", row.id));
    if (progress.deliveredQty > 0 && updatedProgress.remainingQty === 0) {
      d.run(
        "UPDATE orders SET status='done',current_trip_id=?,reason=NULL WHERE id=?",
        updatedProgress.deliveries.at(-1)?.tripId || null,
        row.id,
      );
      if (row.status === "delivery") {
        d.run(
          "UPDATE trip_orders SET outcome='cancel',reason=?,recorded_at=?,items='[]' WHERE trip_id=? AND order_id=? AND outcome='delivery'",
          "Jumlah pesanan disesuaikan; tidak ada sisa pengantaran.",
          d.now(),
          row.current_trip_id,
          row.id,
        );
        if (
          !d.get(
            "SELECT 1 FROM trip_orders WHERE trip_id=? AND outcome='delivery'",
            row.current_trip_id,
          )
        )
          d.run(
            "UPDATE trips SET closed_at=? WHERE id=?",
            d.now(),
            row.current_trip_id,
          );
      }
    } else if (row.status === "delivery")
      d.run(
        "UPDATE trip_orders SET items=? WHERE trip_id=? AND order_id=? AND outcome='delivery'",
        JSON.stringify(updatedProgress.remainingItems),
        row.current_trip_id,
        row.id,
      );
    d.auditOrderItems(ctx.user, row, lines, discounts);
    return orderWithPayment(d.find("orders", row.id));
  });
  route("PATCH", "/api/orders/:id/status", "orders", (ctx) => {
    const row = d.find("orders", ctx.params.id),
      b = ctx.body;
    if (row.version !== b.version)
      fail("Pesanan sudah berubah. Muat ulang.", 409);
    if (
      !["new", "pickup", "fill", "failed", "partial"].includes(row.status) ||
      !["pickup", "fill", "cancel"].includes(b.status)
    )
      fail(
        "Status ini mengikuti proses trip dan tidak dapat diubah di sini.",
        409,
      );
    const reason =
      b.status === "cancel" ? text(b.reason, "Alasan batal", 500) : null;
    if (b.status === "cancel" && d.orderPrepayment(row.id)?.available > 0)
      fail(
        "Koreksi pembayaran menjadi Rp0 sebelum membatalkan pesanan lunas.",
        409,
      );
    d.run(
      "UPDATE orders SET status=?,reason=?,version=version+1 WHERE id=?",
      b.status,
      reason,
      row.id,
    );
    d.audit(
      ctx.user,
      "order.status",
      row.id,
      { status: row.status },
      { status: b.status, reason },
    );
    return { ok: true };
  });
  route("POST", "/api/trips", "trips", (ctx) => {
    const ids = ctx.body.orderIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length
    )
      fail("Pilih pesanan untuk trip.");
    if (ctx.body.courierId && ctx.body.courierId !== ctx.user.id)
      fail("Kurir mengikuti akun yang mengambil foto muatan.");
    const courierId = ctx.user.id,
      courier = safeUser(d.find("users", courierId));
    if (!courier.active || !has(courier, "trips"))
      fail("Kurir tidak aktif atau belum diberi akses trip.");
    const rows = ids.map((key) => d.find("orders", key));
    if (
      rows.some(
        (r) =>
          r.kind !== "delivery" ||
          !["new", "pickup", "fill", "failed", "partial"].includes(r.status),
      )
    )
      fail(
        "Salah satu pesanan sudah diambil atau tidak dapat diberangkatkan.",
        409,
      );
    const tripId = id(),
      time = d.now(),
      day = dayWib(time),
      number = d.get(
        "SELECT COALESCE(MAX(number),0)+1 n FROM trips WHERE day=?",
        day,
      ).n,
      photoId = d.photo(ctx.user, ctx.body.photo, "trip");
    d.run(
      "INSERT INTO trips VALUES(?,?,?,?,?,?,?)",
      tripId,
      number,
      day,
      courierId,
      time,
      null,
      photoId,
    );
    for (const row of rows) {
      d.run(
        "INSERT INTO trip_orders(trip_id,order_id,items) VALUES(?,?,?)",
        tripId,
        row.id,
        JSON.stringify(d.deliveryProgress(row).remainingItems),
      );
      d.run(
        "UPDATE orders SET status='delivery',current_trip_id=?,first_departure_at=COALESCE(first_departure_at,?),version=version+1 WHERE id=?",
        tripId,
        time,
        row.id,
      );
    }
    d.audit(ctx.user, "trip.depart", tripId, null, {
      orderIds: ids,
      courierId,
    });
    return { id: tripId, number };
  });
  route("POST", "/api/trips/:id/orders/:orderId/result", "trips", (ctx) => {
    const trip = d.ownTrip(ctx.user, ctx.params.id),
      row = d.find("orders", ctx.params.orderId),
      attempt = d.get(
        "SELECT * FROM trip_orders WHERE trip_id=? AND order_id=?",
        trip.id,
        row.id,
      );
    if (
      !attempt ||
      attempt.outcome !== "delivery" ||
      row.current_trip_id !== trip.id ||
      row.status !== "delivery"
    )
      fail("Hasil pengantaran ini sudah dicatat atau berubah.", 409);
    const b = ctx.body;
    if (b.version !== undefined && b.version !== row.version)
      fail("Pesanan sudah diubah. Muat ulang jumlah pengantaran.", 409);
    if (!["done", "failed", "cancel"].includes(b.outcome))
      fail("Pilih hasil pengantaran.");
    let result = {};
    const reason = b.outcome !== "done" ? text(b.reason, "Alasan", 500) : null;
    if (b.outcome === "cancel" && d.orderPrepayment(row.id)?.available > 0)
      fail(
        "Koreksi pembayaran menjadi Rp0 sebelum membatalkan pesanan lunas.",
        409,
      );
    if (b.outcome === "done") result = d.complete(ctx.user, row, b, trip.id);
    else {
      if (
        d.get(
          "SELECT id FROM invoices WHERE order_id=? AND trip_id=?",
          row.id,
          trip.id,
        )
      )
        fail("Pesanan telah memiliki transaksi.", 409);
      d.run(
        "UPDATE orders SET status=?,reason=?,version=version+1 WHERE id=?",
        b.outcome,
        reason,
        row.id,
      );
    }
    d.run(
      "UPDATE trip_orders SET outcome=?,reason=?,recorded_at=?,items=? WHERE trip_id=? AND order_id=?",
      result.partial ? "partial" : b.outcome,
      reason,
      d.now(),
      result.invoice ? JSON.stringify(result.invoice.items) : attempt.items,
      trip.id,
      row.id,
    );
    if (
      !d.get(
        "SELECT 1 FROM trip_orders WHERE trip_id=? AND outcome='delivery'",
        trip.id,
      )
    )
      d.run("UPDATE trips SET closed_at=? WHERE id=?", d.now(), trip.id);
    d.audit(
      ctx.user,
      "trip.result",
      row.id,
      { tripId: trip.id },
      { outcome: result.partial ? "partial" : b.outcome, reason },
    );
    return result;
  });
  route("POST", "/api/counter", "counter", (ctx) => {
    const timing = ctx.body.paymentTiming;
    if (timing !== undefined) {
      if (!["now", "later"].includes(timing)) fail("Pilih waktu pembayaran.");
      if (timing === "now" && !["Tunai", "QRIS"].includes(ctx.body.method))
        fail("Pilih metode Tunai atau QRIS.");
      if (
        timing === "later" &&
        (!ctx.body.customerId ||
          ctx.body.paid !== 0 ||
          ctx.body.method !== "Utang")
      )
        fail("Bayar nanti hanya untuk pelanggan dan dicatat sebagai utang.");
    }
    const order = d.order(ctx.user, ctx.body, "counter");
    const result = d.complete(ctx.user, order, ctx.body);
    return { ...result, receipt: d.invoiceReceipt(result.invoice.id) };
  });
  route("GET", "/api/orders", "login", (ctx) => {
    if (
      !["orders", "trips", "counter", "reports"].some((permission) =>
        has(ctx.user, permission),
      )
    )
      fail("Akun ini tidak memiliki akses pesanan.", 403);
    const { from, to, start, end } = d.period(ctx.query),
      filter = ctx.query.get("filter") || "all",
      search = (ctx.query.get("search") || "").trim(),
      limit = integer(
        Number(ctx.query.get("limit") || 50),
        "Jumlah pesanan",
        1,
        50,
      ),
      states = {
        ...displayStatusGroups,
        all: [],
        orders: ["new", "pickup", "partial"],
        fill: ["fill"],
        delivery: ["delivery"],
        failed: ["failed", "cancel"],
      },
      clauses = ["o.created_at>=?", "o.created_at<?"],
      params = [start, end];
    if (!Object.hasOwn(states, filter)) fail("Filter pesanan belum benar.");
    if (search.length > 100) fail("Pencarian maksimal 100 karakter.");
    if (states[filter].length) {
      clauses.push(
        "o.status IN (" + states[filter].map(() => "?").join(",") + ")",
      );
      params.push(...states[filter]);
    }
    if (search) {
      clauses.push("instr(lower(o.name||' '||o.code),lower(?))>0");
      params.push(search);
    }
    const rawCursor = ctx.query.get("cursor");
    if (rawCursor) {
      let cursor;
      try {
        if (rawCursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(rawCursor))
          throw Error();
        cursor = JSON.parse(
          Buffer.from(rawCursor, "base64url").toString("utf8"),
        );
        if (
          cursor.v !== 1 ||
          cursor.from !== from ||
          cursor.to !== to ||
          cursor.filter !== filter ||
          cursor.search !== search ||
          typeof cursor.at !== "string" ||
          cursor.at.length > 40 ||
          !Number.isFinite(Date.parse(cursor.at)) ||
          typeof cursor.id !== "string" ||
          !cursor.id ||
          cursor.id.length > 100
        )
          throw Error();
      } catch {
        fail("Halaman pesanan tidak cocok. Pilih ulang filter tanggal.");
      }
      clauses.push("(o.received_at>? OR (o.received_at=? AND o.id>?))");
      params.push(cursor.at, cursor.at, cursor.id);
    }
    const rows = d.all(
      "SELECT o.*,u.name courier FROM orders o LEFT JOIN trips t ON t.id=o.current_trip_id LEFT JOIN users u ON u.id=t.courier_id WHERE " +
        clauses.join(" AND ") +
        " ORDER BY o.received_at ASC,o.id ASC LIMIT ?",
      ...params,
      limit + 1,
    );
    const page = rows.slice(0, limit),
      hasMore = rows.length > limit,
      last = page.at(-1);
    return {
      orders: page.map(orderWithPayment),
      hasMore,
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              from,
              to,
              filter,
              search,
              at: last.received_at,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
      truncated: hasMore,
    };
  });
  route("GET", "/api/debt-payments", "debts", (ctx) => {
    const params = [],
      clauses = ["p.customer_id IS NOT NULL", "p.amount>0"];
    if (ctx.query.get("period") !== "all") {
      const { start, end } = d.period(ctx.query);
      clauses.push("p.created_at>=?", "p.created_at<?");
      params.push(start, end);
    }
    const search = (ctx.query.get("search") || "").trim();
    if (search.length > 100) fail("Pencarian maksimal 100 karakter.");
    if (search) {
      clauses.push(
        "instr(lower(c.code||' '||c.name||' '||u.name||' '||u.username),lower(?))>0",
      );
      params.push(search);
    }
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman pembayaran",
      0,
      10000000,
    );
    const source =
      " FROM payments p JOIN users u ON u.id=p.actor_id JOIN customers c ON c.id=p.customer_id WHERE " +
      clauses.join(" AND ");
    const rows = d.all(
      "SELECT p.id,p.amount,p.method,p.proof_id,p.created_at,p.actor_id,u.name actor,c.id customer_id,c.code customer_code,c.name customer" +
        source +
        " ORDER BY p.created_at DESC,p.rowid DESC LIMIT 30 OFFSET ?",
      ...params,
      offset,
    );
    const { total } = d.get("SELECT COUNT(*) total" + source, ...params);
    return { rows, total, offset, hasMore: offset + rows.length < total };
  });
  route("GET", "/api/debt-payments/:id", "debts", (ctx) => {
    const row = d.get(
      `SELECT p.id,p.amount,p.method,p.created_at,u.name actor,
        c.code customer_code,c.name customer_name,op.payment_id prepayment,
        (SELECT a.after_json FROM audit a WHERE a.object_id=p.id AND a.action='payment.create' ORDER BY a.created_at,a.id LIMIT 1) metadata,
        EXISTS(SELECT 1 FROM audit a WHERE a.object_id=i.order_id AND a.action='order.complete' AND json_extract(a.after_json,'$.paymentId')=p.id) immediate
        FROM payments p JOIN users u ON u.id=p.actor_id JOIN customers c ON c.id=p.customer_id
        LEFT JOIN order_prepayments op ON op.payment_id=p.id
        LEFT JOIN invoices i ON i.id=json_extract(p.scope,'$[0]')
        WHERE p.id=? AND p.amount>0`,
      ctx.params.id,
    );
    if (!row) fail("Pembayaran tidak ditemukan.", 404);
    const { prepayment, metadata, immediate, ...payment } = row;
    const allocations = d.all(
      "SELECT i.id,i.recorded_at,a.amount FROM allocations a JOIN invoices i ON i.id=a.invoice_id WHERE a.payment_id=? ORDER BY i.recorded_at,i.id",
      payment.id,
    );
    return {
      ...payment,
      allocations,
      kind: isSaleReceipt({ prepayment, metadata, immediate })
        ? "payment"
        : "debt-payment",
    };
  });
  route("GET", "/api/customers/:id/debts", "debts", (ctx) => {
    d.find("customers", ctx.params.id);
    const payments = new Map();
    for (const p of d.all(
      "SELECT a.invoice_id,a.amount,p.id,p.created_at,p.method,u.name actor FROM allocations a JOIN payments p ON p.id=a.payment_id JOIN invoices i ON i.id=a.invoice_id JOIN users u ON u.id=p.actor_id WHERE i.customer_id=? AND a.amount>0 AND p.amount>0 ORDER BY p.created_at,p.rowid",
      ctx.params.id,
    )) {
      if (!payments.has(p.invoice_id)) payments.set(p.invoice_id, []);
      payments.get(p.invoice_id).push(p);
    }
    return d
      .all(
        d.invoiceQuery +
          " WHERE i.customer_id=? AND (i.net+i.shipping>COALESCE((SELECT SUM(amount) FROM allocations WHERE invoice_id=i.id),0) OR i.recorded_at>=?) ORDER BY i.recorded_at ASC,i.id",
        ctx.params.id,
        new Date(new Date(d.now()).getTime() - 90 * 86400000).toISOString(),
      )
      .map(decodeInvoice)
      .map((i) => ({
        ...i,
        debt_at: i.recorded_at,
        payments: payments.get(i.id) || [],
        settled_at:
          i.left === 0 ? payments.get(i.id)?.at(-1)?.created_at || null : null,
      }));
  });
  route("POST", "/api/customers/:id/payments", "debts", (ctx) => {
    d.find("customers", ctx.params.id);
    let ids = ctx.body.invoiceIds;
    if (ids === undefined || (Array.isArray(ids) && !ids.length))
      ids = d
        .all(
          d.invoiceQuery + " WHERE i.customer_id=? ORDER BY i.recorded_at,i.id",
          ctx.params.id,
        )
        .map(decodeInvoice)
        .filter((i) => i.left > 0)
        .map((i) => i.id);
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      fail("Pilih tagihan yang belum lunas.");
    for (const key of ids) {
      const row = d.invoice(key);
      if (row.customer_id !== ctx.params.id)
        fail("Tagihan bukan milik pelanggan ini.");
    }
    integer(ctx.body.paid, "Dibayar", 1);
    return { id: d.payment(ctx.user, ctx.body, ids, ctx.params.id) };
  });
  route("GET", "/api/customers/:id/payments", "debts", (ctx) => {
    d.find("customers", ctx.params.id);
    return d.all(
      "SELECT p.id,p.amount,p.method,p.proof_id,p.created_at,p.actor_id,u.name actor FROM payments p JOIN users u ON u.id=p.actor_id WHERE p.customer_id=? ORDER BY p.created_at DESC,p.rowid DESC LIMIT 100",
      ctx.params.id,
    );
  });
  route("GET", "/api/payments", "correct", (ctx) =>
    d.all(
      "SELECT p.id,p.amount,p.method,p.tender,p.proof_id,p.created_at,p.actor_id,p.version,u.name actor,c.name customer FROM payments p JOIN users u ON u.id=p.actor_id LEFT JOIN customers c ON c.id=p.customer_id" +
        (ctx.user.owner ? "" : " WHERE p.actor_id=?") +
        " ORDER BY p.created_at DESC LIMIT 200",
      ...(ctx.user.owner ? [] : [ctx.user.id]),
    ),
  );
  route("PATCH", "/api/payments/:id", "correct", (ctx) => {
    const p = d.find("payments", ctx.params.id),
      b = ctx.body;
    if (!ctx.user.owner && p.actor_id !== ctx.user.id)
      fail("Hanya dapat mengoreksi catatan sendiri.", 403);
    if (p.version !== b.version)
      fail("Pembayaran sudah dikoreksi. Muat ulang.", 409);
    const reason = text(b.reason, "Alasan koreksi", 500),
      amount = integer(b.amount, "Nominal pembayaran");
    if (!["Tunai", "QRIS"].includes(b.method)) fail("Pilih metode pembayaran.");
    const scope = JSON.parse(p.scope);
    const advanceOrder = d.get(
      "SELECT order_id FROM order_prepayments WHERE payment_id=?",
      p.id,
    );
    const pendingAdvance =
      advanceOrder &&
      !d.get("SELECT id FROM invoices WHERE order_id=?", advanceOrder.order_id);
    if (
      pendingAdvance &&
      ![0, d.orderPrepayment(advanceOrder.order_id).total].includes(amount)
    )
      fail("Pembayaran awal harus lunas atau Rp0 untuk pembatalan.");
    if (!pendingAdvance && !p.customer_id && amount !== p.amount)
      fail(
        "Koreksi pembeli umum tidak boleh menimbulkan utang atau kelebihan bayar.",
      );
    const tender =
      b.method === "Tunai" && b.tender != null
        ? integer(b.tender, "Uang diterima", amount)
        : null;
    d.run("DELETE FROM allocations WHERE payment_id=?", p.id);
    if (!pendingAdvance) {
      const allocation = advanceOrder
        ? Math.min(
            amount,
            scope.reduce((sum, key) => sum + d.invoice(key).left, 0),
          )
        : amount;
      d.allocate(p.id, scope, allocation);
    }
    d.run(
      "UPDATE payments SET amount=?,method=?,tender=?,version=version+1 WHERE id=?",
      amount,
      b.method,
      tender,
      p.id,
    );
    d.audit(
      ctx.user,
      "payment.correct",
      p.id,
      { amount: p.amount, method: p.method },
      { amount, method: b.method, reason },
    );
    return { ok: true };
  });
  route("GET", "/api/reports", "reports", (ctx) =>
    d.report(ctx.user, ctx.query),
  );
  route("GET", "/api/customers/:id/purchases", "reports", (ctx) => {
    d.find("customers", ctx.params.id);
    const params = [ctx.params.id];
    let condition = " WHERE i.customer_id=?";
    if (ctx.query.get("period") !== "all") {
      const { start, end } = d.period(ctx.query);
      condition += " AND i.recorded_at>=? AND i.recorded_at<?";
      params.push(start, end);
    }
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman riwayat",
      0,
      10000000,
    );
    const stats = d.get(
      "SELECT COUNT(*) count,COALESCE(SUM(net+shipping),0) sales FROM invoices i" +
        condition,
      ...params,
    );
    const rows = d
      .all(
        d.invoiceQuery +
          condition +
          " ORDER BY i.recorded_at DESC,i.id DESC LIMIT 20 OFFSET ?",
        ...params,
        offset,
      )
      .map(decodeInvoice);
    return { stats, rows, offset, hasMore: offset + rows.length < stats.count };
  });
  route("GET", "/api/customer-purchases", "reports", (ctx) => {
    const allTime = ctx.query.get("period") === "all";
    const { start, end } = allTime ? {} : d.period(ctx.query);
    return d.all(
      "SELECT customer_id id,COUNT(*) count,SUM(net+shipping) total,MAX(recorded_at) latest FROM invoices WHERE customer_id IS NOT NULL" +
        (allTime ? "" : " AND recorded_at>=? AND recorded_at<?") +
        " GROUP BY customer_id",
      ...(allTime ? [] : [start, end]),
    );
  });
  route("GET", "/api/history", "login", (ctx) => {
    if (
      !["orders", "counter", "trips", "reports"].some((p) => has(ctx.user, p))
    )
      fail("Tidak ada akses riwayat.", 403);
    const { start, end } = d.period(ctx.query);
    return d
      .all(
        d.invoiceQuery +
          " WHERE i.recorded_at>=? AND i.recorded_at<?" +
          (has(ctx.user, "reports") ? "" : " AND i.actor_id=?") +
          " ORDER BY i.recorded_at DESC LIMIT 500",
        ...(has(ctx.user, "reports")
          ? [start, end]
          : [start, end, ctx.user.id]),
      )
      .map(decodeInvoice);
  });
  route("POST", "/api/attendance", "login", (ctx) => {
    const day = dayWib(d.now()),
      existing = d.get(
        "SELECT * FROM attendance WHERE user_id=? AND day=?",
        ctx.user.id,
        day,
      );
    if (existing) return existing;
    const photoId = d.photo(ctx.user, ctx.body.photo, "attendance"),
      recordId = id();
    d.run(
      "INSERT INTO attendance VALUES(?,?,?,?,?)",
      recordId,
      ctx.user.id,
      day,
      d.now(),
      photoId,
    );
    d.audit(ctx.user, "attendance.in", recordId, null, { day });
    return d.find("attendance", recordId);
  });
  route("GET", "/api/account/attendance", "login", (ctx) => ({
    today: dayWib(d.now()),
    current:
      d.get(
        "SELECT id,day,created_at,photo_id FROM attendance WHERE user_id=? AND day=?",
        ctx.user.id,
        dayWib(d.now()),
      ) || null,
    rows: d.all(
      "SELECT id,day,created_at,photo_id FROM attendance WHERE user_id=? ORDER BY day DESC,created_at DESC LIMIT 7",
      ctx.user.id,
    ),
  }));
  route("PATCH", "/api/account", "login", (ctx) =>
    updateAccountProfile(ctx, d.find("users", ctx.user.id)),
  );
  route("POST", "/api/staff", "staff", (ctx) => {
    if (!ctx.user.owner) fail("Pengelolaan akun dilakukan owner.", 403);
    const b = ctx.body,
      userId = id(),
      permissions = perms(b.permissions, b.role);
    d.run(
      "INSERT INTO users VALUES(?,?,?,?,?,?,?,?)",
      userId,
      username(b.username),
      text(b.name, "Nama staf"),
      passwordHash(b.password),
      0,
      1,
      permissions,
      d.now(),
    );
    d.audit(ctx.user, "staff.create", userId, null, {
      name: b.name,
      permissions: JSON.parse(permissions),
    });
    return { id: userId };
  });
  route("PATCH", "/api/staff/:id", "staff", (ctx) => {
    if (!ctx.user.owner) fail("Pengelolaan akun dilakukan owner.", 403);
    const previous = d.find("users", ctx.params.id),
      b = ctx.body;
    if (previous.owner) {
      if (previous.id !== ctx.user.id)
        fail("Akun owner hanya dapat diubah oleh pemilik akun tersebut.", 403);
      if (b.active === false || b.owner === false)
        fail("Akun owner tidak dapat dinonaktifkan atau diturunkan haknya.");
      return updateAccountProfile(ctx, previous);
    }
    if (
      d.get(
        "SELECT key FROM settings WHERE key=?",
        "staffArchived:" + previous.id,
      )
    )
      fail("Akun staf sudah dihapus dari daftar.", 409);
    if (typeof b.active !== "boolean") fail("Status akun belum benar.");
    const permissions = perms(b.permissions, b.role);
    d.run(
      "UPDATE users SET name=?,active=?,permissions=?,username=? WHERE id=?",
      text(b.name, "Nama staf"),
      b.active ? 1 : 0,
      permissions,
      b.username === undefined ? previous.username : username(b.username),
      previous.id,
    );
    d.run("DELETE FROM sessions WHERE user_id=?", previous.id);
    d.audit(ctx.user, "staff.update", previous.id, safeUser(previous), {
      name: b.name,
      username: b.username || previous.username,
      active: b.active,
      permissions: JSON.parse(permissions),
    });
    return { ok: true };
  });
  route("DELETE", "/api/staff/:id", "staff", (ctx) => {
    if (!ctx.user.owner) fail("Pengelolaan akun dilakukan owner.", 403);
    const previous = d.find("users", ctx.params.id);
    if (previous.owner) fail("Akun owner tidak dapat dihapus.");
    if (
      d.get(
        "SELECT id FROM trips WHERE courier_id=? AND closed_at IS NULL",
        previous.id,
      )
    )
      fail("Selesaikan trip aktif staf sebelum menghapus akun.", 409);
    d.run("UPDATE users SET active=0,permissions='[]' WHERE id=?", previous.id);
    d.run("DELETE FROM sessions WHERE user_id=?", previous.id);
    d.run(
      "INSERT OR IGNORE INTO settings VALUES(?,?)",
      "staffArchived:" + previous.id,
      d.now(),
    );
    d.audit(ctx.user, "staff.archive", previous.id, safeUser(previous), {
      archived: true,
    });
    return { ok: true };
  });
  route("POST", "/api/staff/:id/password", "staff", (ctx) => {
    if (supabaseAuth)
      fail("Kata sandi akun ini dikelola melalui Supabase Auth.", 409);
    if (!ctx.user.owner) fail("Reset kata sandi dilakukan owner.", 403);
    const previous = d.find("users", ctx.params.id);
    if (previous.owner) {
      if (previous.id !== ctx.user.id)
        fail(
          "Kata sandi owner hanya dapat diubah oleh pemilik akun tersebut.",
          403,
        );
      return changeOwnPassword(ctx, previous);
    }
    d.run(
      "UPDATE users SET password_hash=? WHERE id=?",
      passwordHash(ctx.body.password),
      previous.id,
    );
    d.run("DELETE FROM sessions WHERE user_id=?", previous.id);
    d.audit(ctx.user, "staff.password-reset", previous.id, null, null);
    return { ok: true };
  });
  route("POST", "/api/password", "login", (ctx) => {
    const user = d.find("users", ctx.user.id);
    return changeOwnPassword(ctx, user);
  });
  route("PATCH", "/api/settings", "login", (ctx) => {
    if (!ctx.user.owner) fail("Pengaturan depot dilakukan owner.", 403);
    const changes = {};
    if (ctx.body.name !== undefined)
      changes.name = text(ctx.body.name, "Nama depot");
    if (ctx.body.deliveryDuration !== undefined) {
      if (!validDuration(ctx.body.deliveryDuration))
        fail("Batas menit harus berurutan, dari 1 sampai 1440 menit.");
      changes.deliveryDuration = JSON.stringify(ctx.body.deliveryDuration);
    }
    if (ctx.body.durationCategories !== undefined) {
      if (!validDurationCategories(ctx.body.durationCategories))
        fail(
          "Kategori belum benar. Nama dan batas menit harus unik, mulai dari 0, dengan warna HEX yang valid.",
        );
      changes.durationCategories = JSON.stringify(
        ctx.body.durationCategories
          .slice()
          .sort((a, b) => a.from - b.from)
          .map((b) => ({
            id: b.id,
            name: b.name.trim(),
            from: b.from,
            color: b.color.toLowerCase(),
          })),
      );
    }
    if (!Object.keys(changes).length)
      fail("Belum ada pengaturan yang dipilih.");
    for (const [key, value] of Object.entries(changes))
      d.run(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        key,
        value,
      );
    d.audit(ctx.user, "settings.update", "application", null, changes);
    return { ok: true };
  });
  route("GET", "/api/audit", "reports", () =>
    d.all(
      "SELECT a.*,u.name actor FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300",
    ),
  );
  route("GET", "/api/photos/:id", "login", (ctx) => {
    const p = d.find("photos", ctx.params.id),
      u = ctx.user;
    const allowed =
      u.owner ||
      p.owner_id === u.id ||
      (p.kind === "attendance" && has(u, "attendanceView")) ||
      (p.kind === "house" &&
        ["customers", "orders", "trips"].some((x) => has(u, x))) ||
      (p.kind === "proof" && has(u, "reports")) ||
      (p.kind === "expense" && (has(u, "reports") || has(u, "expenses"))) ||
      (p.kind === "water-meter" &&
        (has(u, "reports") || has(u, "waterControl"))) ||
      (p.kind === "trip" &&
        d.get(
          "SELECT id FROM trips WHERE photo_id=? AND courier_id=?",
          p.id,
          u.id,
        ));
    if (!allowed) fail("Tidak ada akses foto.", 403);
    return { [deferredPhoto]: photoStorage.prepareRead(p) };
  });

  registerCashRoutes(route, db, d);
  registerReportRoutes(route, d);
  registerCashFlowRoutes(route, d);
  registerWaterControl(route, db, d);
  const handle = async (req, res) => {
    let cloudScope;
    const headers = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-store",
      "X-Frame-Options": "SAMEORIGIN",
      "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    };
    if (!options.dev)
      headers["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        if (options.staticHandler) return options.staticHandler(req, res);
        const base = resolve(options.distPath || "dist"),
          relative = decodeURIComponent(url.pathname),
          target = resolve(base, "." + relative);
        if (target !== base && !target.startsWith(base + sep))
          fail("Tidak ditemukan.", 404);
        let file = target;
        try {
          if (!(await stat(file)).isFile()) file = resolve(base, "index.html");
        } catch {
          if (extname(target)) fail("Tidak ditemukan.", 404);
          file = resolve(base, "index.html");
        }
        const mime =
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
            ".woff": "font/woff",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[extname(file)] || "application/octet-stream";
        let content;
        try {
          content = await readFile(file);
        } catch (error) {
          if (error.code === "ENOENT")
            fail("Tampilan sedang diperbarui. Muat ulang sesaat lagi.", 503);
          throw error;
        }
        res.writeHead(200, {
          ...headers,
          "Content-Type": mime,
          "Cache-Control": file.includes(`${sep}assets${sep}`)
            ? "public,max-age=31536000,immutable"
            : "no-cache",
        });
        res.end(content);
        return;
      }
      const match = routes.find(
        (r) => r.method === req.method && r.regex.test(url.pathname),
      );
      if (!match) fail("Layanan tidak ditemukan.", 404);
      if (match.permission && !authCookie(req, "depot_session"))
        fail("Silakan masuk kembali.", 401);
      let body = {};
      if (!["GET", "HEAD"].includes(req.method)) {
        const origin = req.headers.origin,
          expected =
            process.env.APP_ORIGIN ||
            `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
        if (origin && origin !== expected)
          fail("Asal permintaan tidak diizinkan.", 403);
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          fail("Gunakan format JSON.", 415);
        const maximum = options.maxBodyBytes ?? 8 * 1024 * 1024;
        let parsed;
        try {
          parsed = options.acceptParsedBody ? req.body : undefined;
        } catch {
          fail("Data permintaan belum benar.");
        }
        if (parsed !== undefined) {
          if (Buffer.byteLength(JSON.stringify(parsed)) > maximum)
            fail(
              "Data terlalu besar. Kurangi ukuran foto dan coba kembali.",
              413,
            );
          body = parsed;
        } else {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > maximum)
              fail(
                "Data terlalu besar. Kurangi ukuran foto dan coba kembali.",
                413,
              );
            chunks.push(chunk);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          } catch {
            fail("Data permintaan belum benar.");
          }
        }
        if (!body || Array.isArray(body) || typeof body !== "object")
          fail("Data permintaan belum benar.");
      }
      if (url.pathname === "/api/login" && options.loginLimiter)
        await options.loginLimiter.consume(body.username);
      if (options.cloud && url.pathname !== "/api/health")
        cloudScope = await options.cloud.begin();
      const user = [
        "/api/logout",
        "/api/login",
        "/api/setup",
        "/api/health",
      ].includes(url.pathname)
        ? null
        : await userByToken(req, headers);
      if (match.permission && !user) fail("Silakan masuk kembali.", 401);
      if (match.permission && match.permission !== "login")
        requireAccess(user, match.permission);
      const ctx = {
        req,
        user,
        body,
        query: url.searchParams,
        params: url.pathname.match(match.regex).groups || {},
        headers,
      };
      let result;
      const mutation =
        !!user &&
        !["GET", "HEAD"].includes(req.method) &&
        !["/api/logout", "/api/login", "/api/setup"].includes(url.pathname);
      if (mutation) {
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[-a-zA-Z0-9]{16,100}$/.test(key))
          fail("Kunci penyimpanan belum benar.");
        const fingerprint = hash(
          req.method + url.pathname + JSON.stringify(body),
        );
        result = transaction(db, () => {
          const previous = d.get(
            "SELECT * FROM idempotency WHERE user_id=? AND key=?",
            user.id,
            key,
          );
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              fail("Kunci penyimpanan sudah digunakan untuk isian lain.", 409);
            return JSON.parse(previous.response);
          }
          const value = match.handler(ctx);
          d.run(
            "INSERT INTO idempotency VALUES(?,?,?,?,?)",
            user.id,
            key,
            fingerprint,
            JSON.stringify(value),
            d.now(),
          );
          return value;
        });
      } else result = await match.handler(ctx);
      let committedVersion;
      if (cloudScope) {
        await photoStorage.flushPending();
        committedVersion = await cloudScope.commit();
        cloudScope = null;
      } else {
        if (!options.cloud && !["GET", "HEAD"].includes(req.method))
          localRevision++;
        committedVersion = options.cloud?.currentVersion() || localVersion();
      }
      headers["X-Data-Version"] = committedVersion;
      feed.notify(committedVersion);
      if (url.pathname === "/api/events") {
        const token = hash(authCookie(req, "depot_session") || "");
        feed.add(req, res, {
          headers,
          currentVersion: committedVersion,
          valid: () =>
            !!d.get(
              "SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.active=1",
              token,
              user.id,
              d.now(),
            ),
        });
        return;
      }
      if (url.pathname === "/api/state")
        result = { ...result, syncVersion: committedVersion };
      if (url.pathname === "/api/sync-version")
        result = { version: committedVersion, day: dayWib(d.now()) };
      if (result?.[deferredPhoto]) result = await result[deferredPhoto]();
      if (result?.binary) {
        if (result.binary.length > (options.maxResponseBytes ?? Infinity))
          fail("Foto terlalu besar untuk ditampilkan. Hubungi owner.", 413);
        res.writeHead(200, { ...headers, "Content-Type": result.mime });
        res.end(result.binary);
      } else {
        const output = JSON.stringify(result);
        if (Buffer.byteLength(output) > (options.maxResponseBytes ?? Infinity))
          fail(
            "Data terlalu banyak. Pilih rentang tanggal yang lebih pendek.",
            413,
          );
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(output);
      }
    } catch (error) {
      if (cloudScope) await cloudScope.rollback();
      const conflict =
          String(error.code).startsWith("ERR_SQLITE") &&
          /UNIQUE constraint/.test(error.message),
        status = error.status || (conflict ? 409 : 500);
      if (status === 500) console.error(error);
      res.writeHead(status, {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(
        JSON.stringify({
          error: conflict
            ? "Data sudah digunakan atau telah tersimpan. Muat ulang untuk memeriksa."
            : status === 500
              ? "Terjadi masalah saat menyimpan. Coba kembali."
              : error.message,
        }),
      );
    }
  };
  const server = http.createServer(handle);
  server.on("listening", () => photoStorage.start());
  return {
    handle,
    server,
    db,
    domain: d,
    photoStorage,
    changeFeed: feed,
    close: async () => {
      feed.close();
      await new Promise((resolveClose) => {
        if (!server.listening) resolveClose();
        else server.close(resolveClose);
      });
      await photoStorage.stop();
      await options.cloud?.close();
      if (db.isOpen) db.close();
    },
  };
}
