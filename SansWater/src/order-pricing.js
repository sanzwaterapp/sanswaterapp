// Shared by the product form and server so unit shipping has one definition.
export const discountEligible = (name) =>
  /^(RO|MINERAL)(?:\s|$|\+)/i.test(String(name).trim());
export const hasItemShipping = (lines) =>
  lines.some((line) => line.shippingRate !== undefined);
export const itemShipping = (lines) =>
  lines.reduce(
    (sum, line) => sum + line.qty * Number(line.shippingRate || 0),
    0,
  );
