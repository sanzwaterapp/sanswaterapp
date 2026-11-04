const colors = [
  ["#315b9c", "#edf3ff"],
  ["#29674c", "#e9f5ef"],
  ["#8a5620", "#fff4e5"],
  ["#69429a", "#f3edff"],
  ["#22666b", "#e8f6f7"],
  ["#93445e", "#fff0f4"],
  ["#4b50a1", "#eff0ff"],
  ["#8c4d30", "#fff0e8"],
];
export function staffColor(key = "") {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const [ink, background] = colors[hash % colors.length];
  return { "--staff-ink": ink, "--staff-bg": background };
}
export function stockMovementNote(row) {
  const note = (row.note || "").trim();
  return row.kind === "sale" && note === "Penjualan selesai" ? "" : note;
}
