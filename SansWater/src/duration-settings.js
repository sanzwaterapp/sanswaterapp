export const DEFAULT_DURATION = { fast: 30, warning: 60, late: 90 };

export function durationLimits(settings = {}) {
  let value;
  try {
    value =
      typeof settings.deliveryDuration === "string"
        ? JSON.parse(settings.deliveryDuration)
        : settings.deliveryDuration;
  } catch {
    /* Older or incomplete settings use the established defaults. */
  }
  return validDuration(value) ? value : DEFAULT_DURATION;
}

export function validDuration(value) {
  return (
    !!value &&
    [value.fast, value.warning, value.late].every(
      (n) => Number.isSafeInteger(n) && n >= 1 && n <= 1440,
    ) &&
    value.fast < value.warning &&
    value.warning < value.late
  );
}

export function validDurationCategories(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    return false;
  const ids = new Set(),
    names = new Set(),
    starts = new Set();
  for (const band of value) {
    if (
      !band ||
      typeof band.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,60}$/.test(band.id) ||
      ids.has(band.id) ||
      typeof band.name !== "string" ||
      !band.name.trim() ||
      band.name.trim().length > 24 ||
      names.has(band.name.trim().toLowerCase()) ||
      !Number.isSafeInteger(band.from) ||
      band.from < 0 ||
      band.from > 1440 ||
      starts.has(band.from) ||
      typeof band.color !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(band.color)
    )
      return false;
    ids.add(band.id);
    names.add(band.name.trim().toLowerCase());
    starts.add(band.from);
  }
  return starts.has(0);
}

export function savedDurationCategories(settings = {}) {
  try {
    const value =
      typeof settings.durationCategories === "string"
        ? JSON.parse(settings.durationCategories)
        : settings.durationCategories;
    return validDurationCategories(value)
      ? value.slice().sort((a, b) => a.from - b.from)
      : null;
  } catch {
    return null;
  }
}

export function durationCategories(settings) {
  const saved = savedDurationCategories(settings);
  if (saved) return saved;
  const { fast, warning, late } = durationLimits(settings);
  return [
    { id: "blue", name: "Cepat", from: 0, color: "#296bc2" },
    { id: "green", name: "Normal", from: fast, color: "#257b4c" },
    { id: "yellow", name: "Waspada", from: warning, color: "#f7cb35" },
    { id: "red", name: "Telat", from: late, color: "#d0354b" },
  ];
}

export function durationBand(minutes, settings) {
  const bands = durationCategories(settings);
  for (let index = bands.length - 1; index >= 0; index--)
    if (minutes >= bands[index].from) return bands[index];
  return bands[0];
}

export function bandRange(bands, id) {
  const sorted = bands.slice().sort((a, b) => a.from - b.from),
    index = sorted.findIndex((b) => b.id === id);
  return index < sorted.length - 1
    ? `${sorted[index].from}–${sorted[index + 1].from - 1} mnt`
    : `≥${sorted[index].from} mnt`;
}

export function readableColor(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179
    ? "#20202b"
    : "#ffffff";
}
