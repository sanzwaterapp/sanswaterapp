// Versions are opaque store IDs plus an increasing commit counter.
export function coversVersion(actual, expected) {
  if (!expected || actual === expected) return true;
  if (!actual) return false;
  const a = actual.lastIndexOf(":"),
    b = expected.lastIndexOf(":");
  if (
    a <= 0 ||
    b <= 0 ||
    actual.slice(0, a) !== expected.slice(0, b) ||
    !/^\d+$/.test(actual.slice(a + 1)) ||
    !/^\d+$/.test(expected.slice(b + 1))
  )
    return false;
  const current = Number(actual.slice(a + 1)),
    minimum = Number(expected.slice(b + 1));
  return (
    Number.isSafeInteger(current) &&
    Number.isSafeInteger(minimum) &&
    current >= minimum
  );
}
