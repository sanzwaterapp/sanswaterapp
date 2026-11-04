export function shiftMonth(month, offset) {
  const date = new Date(month.slice(0, 7) + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function calendarMonth(month) {
  const first = new Date(month + "-01T00:00:00Z");
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  return {
    offset: (first.getUTCDay() + 6) % 7,
    days: Array.from(
      { length: last.getUTCDate() },
      (_, index) => month + "-" + String(index + 1).padStart(2, "0"),
    ),
  };
}

export function pickRangeDate(range, date) {
  if (range.phase === "start" || date < range.from) {
    return { from: date, to: "", phase: "end" };
  }
  return { from: range.from, to: date, phase: "start" };
}
