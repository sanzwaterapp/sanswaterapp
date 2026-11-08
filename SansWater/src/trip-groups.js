// Pengelompokan tampilan; setiap perjalanan tetap memakai ID trip aslinya.
export function groupTripsByNumber(trips, day) {
  const groups = new Map();
  for (const trip of trips) {
    if (day && trip.day !== day) continue;
    const number = Number(trip.number);
    if (!groups.has(number)) groups.set(number, { number, trips: [] });
    groups.get(number).trips.push(trip);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      trips: group.trips
        .slice()
        .sort(
          (a, b) =>
            b.departed_at.localeCompare(a.departed_at) ||
            a.id.localeCompare(b.id),
        ),
      active: group.trips.some((trip) => !trip.closed_at),
      orderCount: group.trips.reduce((n, trip) => n + trip.orders.length, 0),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.number - a.number);
}
