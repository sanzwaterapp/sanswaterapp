// Cash uses payment timestamps and the selected expense day, never invoice sales.
export function cashFlowSummary(db, start, end, holders = [], { includeActive = false } = {}) {
  const from = new Date(Date.parse(start) + 25200000)
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.parse(end) + 25200000).toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT u.id key,u.name,'staff' channel,
    COALESCE(p.cash,0) cash,COALESCE(p.qris,0) qris,
    COALESCE(e.cash,0) expenseCash,COALESCE(e.qris,0) expenseQris,
    COALESCE(e.total,0) outgoing
    FROM users u LEFT JOIN (
      SELECT actor_id,SUM(CASE WHEN method='Tunai' THEN amount ELSE 0 END) cash,
      SUM(CASE WHEN method='QRIS' THEN amount ELSE 0 END) qris FROM payments
      WHERE created_at>=? AND created_at<? GROUP BY actor_id
    ) p ON p.actor_id=u.id LEFT JOIN (
      SELECT actor_id,SUM(amount) total,
      SUM(CASE WHEN from_method='Tunai' THEN amount ELSE 0 END) cash,
      SUM(CASE WHEN from_method='QRIS' THEN amount ELSE 0 END) qris FROM cash_entries
      WHERE kind='expense' AND voided_at IS NULL AND day>=? AND day<? GROUP BY actor_id
    ) e ON e.actor_id=u.id WHERE p.actor_id IS NOT NULL OR e.actor_id IS NOT NULL OR (?=1 AND u.active=1) ORDER BY u.name,u.id`,
    )
    .all(start, end, from, to, includeActive ? 1 : 0);
  const incoming = rows.reduce((sum, r) => sum + r.cash + r.qris, 0),
    outgoing = rows.reduce((sum, r) => sum + r.outgoing, 0);
  const sources = new Map();
  for (const holder of holders)
    for (const actor of holder.actors) {
      const current = sources.get(actor.id) || {
        saleCash: 0,
        saleQris: 0,
        debtCash: 0,
        debtQris: 0,
      };
      for (const key of Object.keys(current)) current[key] += actor[key] || 0;
      sources.set(actor.id, current);
    }
  const staffCash = rows.map((row) => ({
    ...row,
    ...(sources.get(row.key) || {
      saleCash: row.cash,
      saleQris: row.qris,
      debtCash: 0,
      debtQris: 0,
    }),
    net: row.cash + row.qris - row.outgoing,
  }));
  return {
    cashFlow: {
      incoming,
      outgoing,
      net: incoming - outgoing,
      sales: staffCash.reduce(
        (sum, row) => sum + row.saleCash + row.saleQris,
        0,
      ),
      debt: staffCash.reduce(
        (sum, row) => sum + row.debtCash + row.debtQris,
        0,
      ),
    },
    staffCash,
  };
}

export function registerCashFlowRoutes(route, d) {
  route("GET", "/api/report-cashflow", "reports", (ctx) => {
    const p = d.period(ctx.query),
      offset = Number(ctx.query.get("offset") || 0),
      actor = ctx.query.get("actor"),
      fund = ctx.query.get("fund");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) {
      const e = new Error("Halaman belum benar.");
      e.status = 400;
      throw e;
    }
    const sql = `SELECT p.id,'income' kind,p.created_at occurred_at,p.created_at recorded_at,p.method,p.amount,
      COALESCE(c.code||' · ','')||COALESCE(c.name,(SELECT i.customer_name FROM invoices i WHERE i.id=json_extract(p.scope,'$[0]')),(SELECT o.name FROM order_prepayments op JOIN orders o ON o.id=op.order_id WHERE op.payment_id=p.id),'Pembeli umum') description,'' note,u.name actor,p.actor_id,NULL fund
      FROM payments p JOIN users u ON u.id=p.actor_id LEFT JOIN customers c ON c.id=p.customer_id
      WHERE p.created_at>=? AND p.created_at<? AND p.amount>0
      UNION ALL SELECT e.id,'expense',e.day||'T'||substr(datetime(e.created_at,'+7 hours'),12,8)||'+07:00',e.created_at,e.from_method,e.amount,e.category,e.note,u.name,e.actor_id,e.from_fund
      FROM cash_entries e JOIN users u ON u.id=e.actor_id WHERE e.kind='expense' AND e.voided_at IS NULL AND e.day>=? AND e.day<=?`;
    const kind = ctx.query.get("kind");
    if (kind && !["expense", "income"].includes(kind)) {
      const e = new Error("Jenis arus kas belum benar.");
      e.status = 400;
      throw e;
    }
    const clauses = [
      ...(actor ? ["actor_id=?"] : []),
      ...(kind ? ["kind=?"] : []),
      ...(fund ? ["fund=?"] : []),
    ];
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "",
      args = [
        p.start,
        p.end,
        p.from,
        p.to,
        ...(actor ? [actor] : []),
        ...(kind ? [kind] : []),
        ...(fund ? [fund] : []),
      ];
    const total = d.get(
      "SELECT count(*) total FROM (" + sql + ")" + where,
      ...args,
    ).total;
    const rows = d.all(
      "SELECT * FROM (" +
        sql +
        ")" +
        where +
        " ORDER BY datetime(occurred_at) DESC,datetime(recorded_at) DESC,id DESC LIMIT 30 OFFSET ?",
      ...args,
      offset,
    );
    return { rows, total, offset, hasMore: offset + rows.length < total };
  });
}
