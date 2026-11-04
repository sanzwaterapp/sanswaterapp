// Reconcile receipts with completed sales using allocation dates, never adding credit sales to cash.
export function reportReceipts(db, start, end, salesTotal) {
  const allocated = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN i.recorded_at>=? AND i.recorded_at<? THEN a.amount ELSE 0 END),0) sales,
      COALESCE(SUM(CASE WHEN i.recorded_at<? THEN a.amount ELSE 0 END),0) oldDebt,
      COALESCE(SUM(CASE WHEN i.recorded_at>=? THEN a.amount ELSE 0 END),0) advances
    FROM payments p JOIN allocations a ON a.payment_id=p.id
    JOIN invoices i ON i.id=a.invoice_id
    WHERE p.created_at>=? AND p.created_at<?
  `,
    )
    .get(start, end, start, end, start, end);
  const unallocated = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN op.payment_id IS NOT NULL THEN p.amount-COALESCE(a.total,0) ELSE 0 END),0) advances,
      COALESCE(SUM(CASE WHEN op.payment_id IS NULL THEN p.amount-COALESCE(a.total,0) ELSE 0 END),0) other
    FROM payments p
    LEFT JOIN (SELECT payment_id,SUM(amount) total FROM allocations GROUP BY payment_id) a ON a.payment_id=p.id
    LEFT JOIN order_prepayments op ON op.payment_id=p.id
    WHERE p.created_at>=? AND p.created_at<?
  `,
    )
    .get(start, end);
  const receivedBefore = db
    .prepare(
      `
    SELECT COALESCE(SUM(a.amount),0) total
    FROM invoices i JOIN allocations a ON a.invoice_id=i.id
    JOIN payments p ON p.id=a.payment_id
    WHERE i.recorded_at>=? AND i.recorded_at<? AND p.created_at<?
  `,
    )
    .get(start, end, start).total;
  return {
    sales: allocated.sales,
    oldDebt: allocated.oldDebt,
    advances: allocated.advances + unallocated.advances,
    unallocated: unallocated.other,
    receivedBefore,
    outstandingSales: salesTotal - allocated.sales - receivedBefore,
    total:
      allocated.sales +
      allocated.oldDebt +
      allocated.advances +
      unallocated.advances +
      unallocated.other,
  };
}
