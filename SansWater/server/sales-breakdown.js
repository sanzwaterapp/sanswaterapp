const productFamilies = [
  ["ro", "RO", "galon"],
  ["mineral", "Mineral", "galon"],
  ["water", "RO + Mineral", "galon"],
  ["aqua", "AQUA", "galon"],
  ["cleo", "CLEO", "galon"],
  ["galon", "Galon", "galon"],
  ["gas", "Gas", "tabung"],
  ["other", "Lainnya", "unit"],
];

export function productFamily(name) {
  const value = String(name).trim().toUpperCase();
  for (const key of ["ro", "mineral", "aqua", "cleo", "galon", "gas"])
    if (
      value === key.toUpperCase() ||
      value.startsWith(key.toUpperCase() + " ") ||
      value.startsWith(key.toUpperCase() + "+")
    )
      return key;
  return "other";
}

export function salesBreakdown(db, start, end) {
  const totals = new Map(
    productFamilies.map(([key, label, unit]) => [
      key,
      {
        key,
        label,
        unit,
        delivery: 0,
        counter: 0,
        total: 0,
        subtotal: key === "water",
      },
    ]),
  );
  const holders = new Map();
  function holder(key, name, channel) {
    if (!holders.has(key))
      holders.set(key, {
        key,
        name,
        channel,
        invoiceCount: 0,
        galon: 0,
        tabung: 0,
        unit: 0,
        saleCash: 0,
        debtCash: 0,
        cash: 0,
        saleQris: 0,
        debtQris: 0,
        qris: 0,
        actors: [],
      });
    return holders.get(key);
  }
  holder("counter", "Depot", "counter");
  const sales = db
    .prepare(
      `SELECT i.items,i.trip_id,t.courier_id,u.name courier
    FROM invoices i LEFT JOIN trips t ON t.id=i.trip_id LEFT JOIN users u ON u.id=t.courier_id
    WHERE i.recorded_at>=? AND i.recorded_at<?`,
    )
    .all(start, end);
  for (const sale of sales) {
    const channel = sale.trip_id ? "delivery" : "counter";
    const receiver = sale.trip_id
      ? holder(sale.courier_id, sale.courier, channel)
      : holders.get("counter");
    receiver.invoiceCount++;
    for (const line of JSON.parse(sale.items)) {
      const family = totals.get(productFamily(line.name));
      family[channel] += line.qty;
      family.total += line.qty;
      receiver[family.unit] += line.qty;
    }
  }
  const water = totals.get("water");
  for (const key of ["ro", "mineral"]) {
    const row = totals.get(key);
    for (const field of ["delivery", "counter", "total"])
      water[field] += row[field];
  }
  const receipts = db
    .prepare(
      `SELECT p.*,u.name actor,u.permissions,
    op.payment_id prepayment,
    i.trip_id initial_trip,
    (SELECT a.after_json FROM audit a WHERE a.object_id=p.id AND a.action='payment.create' ORDER BY a.created_at,a.id LIMIT 1) metadata,
    EXISTS(SELECT 1 FROM audit a WHERE a.object_id=i.order_id AND a.action='order.complete' AND json_extract(a.after_json,'$.paymentId')=p.id) immediate,
    EXISTS(SELECT 1 FROM trips t WHERE t.courier_id=p.actor_id AND t.departed_at<=p.created_at) courier_before_receipt
    FROM payments p JOIN users u ON u.id=p.actor_id
    LEFT JOIN order_prepayments op ON op.payment_id=p.id
    LEFT JOIN invoices i ON i.id=json_extract(p.scope,'$[0]')
    WHERE p.created_at>=? AND p.created_at<? AND p.method IN ('Tunai','QRIS') AND p.amount>0`,
    )
    .all(start, end);
  for (const receipt of receipts) {
    const metadata = JSON.parse(receipt.metadata || "{}");
    const sale =
      !!receipt.prepayment || metadata.origin === "sale" || !!receipt.immediate;
    const permissions = JSON.parse(receipt.permissions);
    const courier =
      receipt.courier_before_receipt ||
      (permissions.includes("trips") && !permissions.includes("counter"));
    const channel = receipt.prepayment
      ? "counter"
      : metadata.channel ||
        (sale
          ? receipt.initial_trip
            ? "delivery"
            : "counter"
          : courier
            ? "delivery"
            : "counter");
    const receiver =
      channel === "delivery"
        ? holder(receipt.actor_id, receipt.actor, channel)
        : holders.get("counter");
    const methodTotal = receipt.method === "QRIS" ? "qris" : "cash";
    const sourceTotal =
      (sale ? "sale" : "debt") + (receipt.method === "QRIS" ? "Qris" : "Cash");
    receiver[sourceTotal] += receipt.amount;
    receiver[methodTotal] += receipt.amount;
    let actor = receiver.actors.find((a) => a.id === receipt.actor_id);
    if (!actor) {
      actor = {
        id: receipt.actor_id,
        name: receipt.actor,
        saleCash: 0,
        debtCash: 0,
        cash: 0,
        saleQris: 0,
        debtQris: 0,
        qris: 0,
      };
      receiver.actors.push(actor);
    }
    actor[sourceTotal] += receipt.amount;
    actor[methodTotal] += receipt.amount;
  }
  return {
    productTotals: [...totals.values()].filter(
      (row) => row.key !== "other" || row.total > 0,
    ),
    cashHolders: [...holders.values()].sort(
      (a, b) =>
        (a.channel === "counter") - (b.channel === "counter") ||
        a.name.localeCompare(b.name),
    ),
  };
}
