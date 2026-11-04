// Reference capacities supplied by the depot, in liters per product unit.
export const REFERENCE_CAPACITIES = Object.freeze({
  ro: 19,
  "ro besar": 38,
  "ro sedang": 9.5,
  "ro kecil": 6.333333,
  "ro gratis": 19,
  "ro buang": 19,
  mineral: 19,
  "mineral besar": 38,
  "mineral sedang": 9.5,
  "mineral kecil": 6.333333,
  "mineral gratis": 19,
  "mineral buang": 19,
});

export function referenceCapacity(name) {
  return (
    REFERENCE_CAPACITIES[
      String(name).trim().replace(/\s+/g, " ").toLowerCase()
    ] ?? null
  );
}

export function formatLiters(value, maximumFractionDigits = 6) {
  return (
    Number(value).toLocaleString("id-ID", { maximumFractionDigits }) + " L"
  );
}
