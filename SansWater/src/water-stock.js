export const roundWater = (n) => Math.round(n * 1e6) / 1e6;
export function waterGroup(name) {
  const text = String(name || "")
    .trim()
    .toLowerCase();
  if (/^ro\b/.test(text)) return "ro";
  if (/^mineral\b/.test(text)) return "mineral";
  return null;
}
export function stockLiters(rows, group) {
  return roundWater(
    rows
      .filter((row) => row.group === group)
      .reduce((sum, row) => sum + row.qty * row.capacityLiters, 0),
  );
}
export function waterComparison(readings, sales, opening, closing) {
  return [
    { group: "ro", name: "RO", meters: ["ro1", "ro2"] },
    { group: "mineral", name: "Mineral", meters: ["mineral"] },
  ].map(({ group, name, meters }) => {
    const usageLiters = roundWater(
      readings
        .filter((row) => meters.includes(row.meterId))
        .reduce((sum, row) => sum + row.liters, 0),
    );
    const openingLiters = stockLiters(opening, group),
      closingLiters = stockLiters(closing, group);
    const salesLiters = sales[group] || 0;
    const expectedLiters = roundWater(
      salesLiters + closingLiters - openingLiters,
    );
    return {
      group,
      name,
      usageLiters,
      salesLiters,
      openingLiters,
      closingLiters,
      expectedLiters,
      differenceLiters: roundWater(usageLiters - expectedLiters),
    };
  });
}
