export const DEFAULT_PREFERENCES = {
  mode: "light",
  text: "normal",
  density: "comfortable",
  period: "today",
};
export function readPreferences() {
  try {
    return normalizePreferences(
      JSON.parse(localStorage.getItem("depot.preferences") || "{}"),
    );
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
export function normalizePreferences(value = {}) {
  return {
    mode: "light",
    text: value?.text === "large" ? "large" : "normal",
    density: value?.density === "compact" ? "compact" : "comfortable",
    period: ["today", "yesterday", "week", "month"].includes(value?.period)
      ? value.period
      : "today",
  };
}
