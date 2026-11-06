import { waterGroup, roundWater } from "../src/water-stock.js";
// Aggregate immutable invoice snapshots, never the current product catalog.
export function waterSummary(db, start, end, afterInvoice = 0) {
  return db
    .prepare(
      `SELECT
    ROUND(COALESCE(SUM((SELECT SUM(COALESCE(json_extract(line.value,'$.capacityLiters'),0)*json_extract(line.value,'$.qty')) FROM json_each(i.items) line)),0),6) liters,
    COALESCE(SUM(EXISTS(SELECT 1 FROM json_each(i.items) line WHERE json_type(line.value,'$.capacityLiters') IS NULL)),0) legacyInvoices
    FROM invoices i WHERE i.recorded_at>=? AND i.recorded_at<? AND (i.recorded_at>? OR i.rowid>?)`,
    )
    .get(start, end, start, afterInvoice);
}

export function waterBreakdown(db, start, end, afterInvoice = 0) {
  const result = { ro: 0, mineral: 0, ungroupedLiters: 0 };
  for (const invoice of db
    .prepare(
      "SELECT items FROM invoices WHERE recorded_at>=? AND recorded_at<? AND (recorded_at>? OR rowid>?)",
    )
    .all(start, end, start, afterInvoice)) {
    for (const line of JSON.parse(invoice.items)) {
      const liters = (line.capacityLiters || 0) * line.qty;
      const group = waterGroup(line.name);
      if (group) result[group] += liters;
      else result.ungroupedLiters += liters;
    }
  }
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [key, roundWater(value)]),
  );
}

export function waterActivity(db, start, end, afterInvoice = 0) {
  const activity = {
    deliveryOrders: 0,
    counterOrders: 0,
    deliveredUnits: 0,
    counterUnits: 0,
    products: [],
  };
  const products = new Map();
  for (const invoice of db
    .prepare(
      "SELECT items,trip_id FROM invoices WHERE recorded_at>=? AND recorded_at<? AND (recorded_at>? OR rowid>?)",
    )
    .all(start, end, start, afterInvoice)) {
    let units = 0;
    for (const line of JSON.parse(invoice.items)) {
      if (!waterGroup(line.name) || !(line.capacityLiters > 0)) continue;
      units += line.qty;
      const key = line.productId + ":" + line.capacityLiters;
      const product = products.get(key) || {
        name: line.name,
        capacityLiters: line.capacityLiters,
        qty: 0,
        liters: 0,
      };
      product.qty += line.qty;
      product.liters = roundWater(
        product.liters + line.qty * line.capacityLiters,
      );
      products.set(key, product);
    }
    if (units > 0) {
      activity[invoice.trip_id ? "deliveryOrders" : "counterOrders"]++;
      activity[invoice.trip_id ? "deliveredUnits" : "counterUnits"] += units;
    }
  }
  activity.products = [...products.values()];
  return activity;
}
