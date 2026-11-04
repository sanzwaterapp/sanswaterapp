export const CASH_FUNDS = [
  { key: "operating", name: "RO & Mineral", detail: "Isi ulang & operasional" },
  { key: "goods", name: "Air merek & galon", detail: "AQUA, CLEO & Galon" },
  { key: "gas", name: "Gas", detail: "Penjualan & pembelian Gas" },
];
export const CASH_METHODS = ["Tunai", "QRIS"];
export function inferCategoryFund(name) {
  const value = String(name).trim().toLowerCase();
  if (value.includes("isi ulang") || value === "ro" || value === "mineral")
    return "operating";
  if (value.includes("gas")) return "gas";
  if (
    value.includes("galon") ||
    value.includes("air merek") ||
    value === "air" ||
    value === "aqua" ||
    value === "cleo"
  )
    return "goods";
  return null;
}
export function inferCashFund(name) {
  const value = String(name).trim().toUpperCase();
  const match = (prefix) =>
    value === prefix ||
    value.startsWith(prefix + " ") ||
    value.startsWith(prefix + "+");
  if (["RO", "MINERAL"].some(match)) return "operating";
  if (["AQUA", "CLEO", "GALON"].some(match)) return "goods";
  if (match("GAS")) return "gas";
  return null;
}
