// A purchase option can share one stock balance with another mode.
export function productChoiceLabel(product, mode) {
  const name = product.name.toUpperCase();
  if (product.modes.length < 2) return name;
  const kind = mode.name.toLowerCase().replace(/\s+/g, "");
  if (kind === "beli+galon") return name + "+GALON";
  if (kind === "tukargalon") return name;
  return name + " · " + mode.name;
}
