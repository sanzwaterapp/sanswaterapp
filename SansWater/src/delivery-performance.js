import {
  durationLimits,
  savedDurationCategories,
  durationBand,
  bandRange,
} from "./duration-settings.js";
export function deliveryCategories(settings) {
  const custom = savedDurationCategories(settings);
  if (custom)
    return custom
      .slice()
      .reverse()
      .map((b) => ({
        key: b.id,
        label: b.name,
        range: bandRange(custom, b.id),
        color: b.color,
      }));
  const { fast, late } = durationLimits(settings);
  return [
    { key: "late", label: "Telat", range: `≥${late} mnt` },
    { key: "normal", label: "Normal", range: `${fast}–${late - 1} mnt` },
    { key: "fast", label: "Cepat", range: `<${fast} mnt` },
  ];
}
export const DELIVERY_CATEGORIES = deliveryCategories();

export function deliveryCategory(seconds, settings) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (savedDurationCategories(settings))
    return durationBand(seconds / 60, settings).id;
  const { fast, late } = durationLimits(settings);
  return seconds < fast * 60 ? "fast" : seconds < late * 60 ? "normal" : "late";
}
