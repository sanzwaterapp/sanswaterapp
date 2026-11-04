import { CASH_METHODS } from "../src/cash-funds.js";
import { cashFundReport, listCashFunds } from "./cash-ledger.js";
import {
  dayWib,
  fail,
  has,
  id,
  integer,
  requireAccess,
  text,
} from "./domain.js";

export function registerCashRoutes(route, db, d) {
  const fund = (value) => {
    if (
      typeof value !== "string" ||
      !d.get("SELECT id FROM cash_funds WHERE id=?", value)
    )
      fail("Pilih kas yang benar.");
    return value;
  };
  const method = (value) => {
    if (!CASH_METHODS.includes(value)) fail("Pilih Tunai atau QRIS.");
    return value;
  };
  const validDay = (value) => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
      !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value ||
      value > dayWib(d.now())
    )
      fail("Tanggal harus valid dan tidak melewati hari ini.");
    return value;
  };
  const readAccess = (user) => {
    if (!has(user, "reports") && !has(user, "expenses"))
      fail("Akun ini tidak memiliki akses.", 403);
  };
  const holder = (value) => {
    if (["depot", "qris"].includes(value)) return value;
    if (!d.get("SELECT id FROM users WHERE id=? AND active=1", value))
      fail("Pilih pemegang uang.");
    return value;
  };
  route("GET", "/api/cash-options", "login", (ctx) => {
    readAccess(ctx.user);
    return {
      funds: listCashFunds(db),
      users: d.all("SELECT id,name FROM users WHERE active=1 ORDER BY name"),
      stocks: d.all(
        "SELECT s.id,s.qty,s.created_at,p.name FROM stock_movements s JOIN products p ON p.id=s.product_id WHERE s.kind='in' ORDER BY s.created_at DESC,s.id LIMIT 100",
      ),
    };
  });
  route("POST", "/api/cash-funds", "catalog", (ctx) => {
    const key = id(),
      name = text(ctx.body.name, "Nama kas", 60);
    d.run("INSERT INTO cash_funds(id,name) VALUES(?,?)", key, name);
    d.audit(ctx.user, "cash-fund.create", key, null, { name });
    return { id: key };
  });
  route("PATCH", "/api/cash-funds/:id", "catalog", (ctx) => {
    const previous = d.find("cash_funds", ctx.params.id);
    if (previous.version !== ctx.body.version)
      fail("Kas sudah diubah. Muat ulang.", 409);
    const name = text(ctx.body.name, "Nama kas", 60);
    d.run(
      "UPDATE cash_funds SET name=?,version=version+1 WHERE id=?",
      name,
      previous.id,
    );
    d.audit(ctx.user, "cash-fund.update", previous.id, previous, { name });
    return { ok: true };
  });
  route("GET", "/api/cash-ledger", "login", (ctx) => {
    readAccess(ctx.user);
    const period = d.period(
        ctx.query.get("period") === "all"
          ? new URLSearchParams({
              from: "1970-01-01",
              to: dayWib(d.now()),
            })
          : ctx.query,
      ),
      conditions = ["e.day>=?", "e.day<=?"],
      args = [period.from, period.to];
    const filter = ctx.query.get("fund"),
      kind = ctx.query.get("kind");
    if (filter && filter !== "all") {
      fund(filter);
      conditions.push("(e.from_fund=? OR e.to_fund=?)");
      args.push(filter, filter);
    }
    if (kind && kind !== "all") {
      if (!["expense", "transfer"].includes(kind))
        fail("Jenis catatan belum benar.");
      conditions.push("e.kind=?");
      args.push(kind);
    }
    const offset = integer(
      Number(ctx.query.get("offset") || 0),
      "Halaman",
      0,
      10000000,
    );
    const where = " WHERE " + conditions.join(" AND ");
    const total = d.get(
      "SELECT COUNT(*) total FROM cash_entries e" + where,
      ...args,
    ).total;
    const rows = d.all(
      "SELECT e.*,u.name actor,v.name void_actor,p.name product,s.qty stock_qty,fh.name from_holder_name,th.name to_holder_name FROM cash_entries e JOIN users u ON u.id=e.actor_id LEFT JOIN users v ON v.id=e.voided_by LEFT JOIN stock_movements s ON s.id=e.stock_id LEFT JOIN products p ON p.id=s.product_id LEFT JOIN users fh ON fh.id=e.from_holder LEFT JOIN users th ON th.id=e.to_holder" +
        where +
        " ORDER BY e.day DESC,e.created_at DESC,e.id DESC LIMIT 30 OFFSET ?",
      ...args,
      offset,
    );
    return {
      funds: cashFundReport(db, period.start, period.end),
      rows,
      total,
      offset,
      hasMore: offset + rows.length < total,
    };
  });
  route("POST", "/api/cash-setup", "login", () => {
    fail("Saldo awal tidak digunakan pada alur kas ini.", 410);
  });
  route("POST", "/api/cash-entries", "expenses", (ctx) => {
    const b = ctx.body,
      day = validDay(b.day);
    if (b.kind !== "expense")
      fail("Gunakan pencatatan pengeluaran dan pilih kasnya.", 410);
    const fromFund = fund(b.fromFund),
      fromMethod = method(b.fromMethod),
      amount = integer(b.amount, "Nominal", 1);
    const toFund = b.kind === "transfer" ? fund(b.toFund) : null;
    const toMethod = b.kind === "transfer" ? method(b.toMethod) : null;
    const fromHolder = holder(
      b.fromHolder || (fromMethod === "QRIS" ? "qris" : "depot"),
    );
    const toHolder =
      b.kind === "transfer"
        ? holder(b.toHolder || (toMethod === "QRIS" ? "qris" : "depot"))
        : null;
    if (
      b.kind === "transfer" &&
      fromFund === toFund &&
      fromMethod === toMethod &&
      fromHolder === toHolder
    )
      fail("Tujuan perpindahan harus berbeda.");
    const category =
      b.kind === "expense"
        ? text(b.category, "Kategori pengeluaran", 60)
        : "Transfer / setoran";
    const note = b.note ? text(b.note, "Catatan", 500) : "";
    let stockId = null;
    if (b.stockId) {
      if (b.kind !== "expense") fail("Stok terkait hanya untuk pengeluaran.");
      const stock = d.find("stock_movements", b.stockId);
      if (stock.kind !== "in") fail("Pilih stok masuk.");
      stockId = stock.id;
    }
    const proofId = b.proof ? d.photo(ctx.user, b.proof, "expense") : null,
      entryId = id();
    d.run(
      "INSERT INTO cash_entries(id,kind,day,from_fund,to_fund,from_method,to_method,amount,category,note,proof_id,stock_id,from_holder,to_holder,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      entryId,
      b.kind,
      day,
      fromFund,
      toFund,
      fromMethod,
      toMethod,
      amount,
      category,
      note,
      proofId,
      stockId,
      fromHolder,
      toHolder,
      ctx.user.id,
      d.now(),
    );
    d.audit(ctx.user, "cash." + b.kind, entryId, null, {
      ...b,
      proof: undefined,
      proofId,
    });
    return { id: entryId };
  });
  route("POST", "/api/cash-entries/:id/void", "expenses", (ctx) => {
    const row = d.find("cash_entries", ctx.params.id);
    requireAccess(ctx.user, "correct");
    if (!ctx.user.owner && row.actor_id !== ctx.user.id)
      fail("Hanya dapat membatalkan catatan sendiri.", 403);
    if (row.version !== ctx.body.version || row.voided_at)
      fail("Catatan sudah berubah atau dibatalkan.", 409);
    const reason = text(ctx.body.reason, "Alasan pembatalan", 500);
    d.run(
      "UPDATE cash_entries SET void_reason=?,voided_by=?,voided_at=?,version=version+1 WHERE id=?",
      reason,
      ctx.user.id,
      d.now(),
      row.id,
    );
    d.audit(ctx.user, "cash.void", row.id, row, { reason });
    return { ok: true };
  });
}
