// today adalah tanggal operasional WIB dari server, bukan tanggal UTC perangkat.
export function periodDates(today, value) {
  if (value.kind === "yesterday") {
    const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000)
      .toISOString()
      .slice(0, 10);
    return { from: yesterday, to: yesterday };
  }
  if (value.kind === "today") return { from: today, to: today };
  if (value.kind === "week") {
    // Minggu berjalan dimulai Senin, memakai tanggal operasional server.
    const date = new Date(today + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return { from: date.toISOString().slice(0, 10), to: today };
  }
  if (value.kind === "month")
    return { from: today.slice(0, 7) + "-01", to: today };
  return { from: value.from, to: value.to };
}
