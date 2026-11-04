export const orderLineKey = (line) => line.productId + ":" + line.modeId;

// Quantities come from immutable handover/invoice snapshots, never trip loads.
export function orderProgress(items, discounts = {}, invoices = []) {
  const delivered = new Map(),
    usedDiscounts = {};
  for (const invoice of invoices) {
    for (const line of invoice.items) {
      const key = orderLineKey(line),
        previous = delivered.get(key);
      delivered.set(key, { ...line, qty: (previous?.qty || 0) + line.qty });
    }
    for (const [key, value] of Object.entries(invoice.discounts || {}))
      usedDiscounts[key] = (usedDiscounts[key] || 0) + value;
  }
  const deliveredItems = [...delivered.values()];
  const remainingItems = items
    .map((line) => ({
      ...line,
      qty: Math.max(
        0,
        line.qty - (delivered.get(orderLineKey(line))?.qty || 0),
      ),
    }))
    .filter((line) => line.qty > 0);
  return {
    orderedQty: items.reduce((sum, line) => sum + line.qty, 0),
    deliveredQty: deliveredItems.reduce((sum, line) => sum + line.qty, 0),
    remainingQty: remainingItems.reduce((sum, line) => sum + line.qty, 0),
    deliveredItems,
    remainingItems,
    usedDiscounts,
    remainingDiscounts: Object.fromEntries(
      Object.entries(discounts).map(([key, value]) => [
        key,
        Math.max(0, value - (usedDiscounts[key] || 0)),
      ]),
    ),
    deliveries: invoices.map((row) => ({
      id: row.id,
      tripId: row.trip_id,
      at: row.recorded_at,
      items: row.items,
    })),
  };
}

// The final delivery takes rounding remainders, so discounts are never doubled.
export function handoverDiscounts(progress, lines) {
  const gross = (items, id) =>
    items
      .filter((line) => line.productId === id)
      .reduce((sum, line) => sum + line.qty * line.price, 0);
  return Object.fromEntries(
    [...new Set(lines.map((line) => line.productId))].map((id) => {
      const remaining = gross(progress.remainingItems, id),
        selected = gross(lines, id);
      const discount = progress.remainingDiscounts[id] || 0;
      return [
        id,
        remaining
          ? Number((BigInt(discount) * BigInt(selected)) / BigInt(remaining))
          : 0,
      ];
    }),
  );
}
