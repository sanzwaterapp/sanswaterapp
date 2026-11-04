// A statement always includes all outstanding invoices, independent of payment selection.
export function debtStatement(rows) {
  const bills = rows
    .filter((row) => row.left > 0)
    .slice()
    .sort(
      (a, b) =>
        a.recorded_at.localeCompare(b.recorded_at) || a.id.localeCompare(b.id),
    );
  return {
    bills,
    billed: bills.reduce((sum, row) => sum + row.total, 0),
    paid: bills.reduce((sum, row) => sum + row.paid, 0),
    remaining: bills.reduce((sum, row) => sum + row.left, 0),
  };
}
