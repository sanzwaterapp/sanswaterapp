import { test } from "node:test";
import assert from "node:assert/strict";
import { periodDates } from "../src/period-range.js";

test("Minggu ini mencakup tujuh tanggal WIB termasuk hari ini di semua batas kalender", () => {
  for (const [today, from] of [
    ["2026-11-16", "2026-11-10"],
    ["2026-10-22", "2026-10-16"],
    ["2026-10-19", "2026-10-13"],
    ["2026-10-25", "2026-10-19"],
    ["2026-01-01", "2025-12-26"],
    ["2024-03-01", "2024-02-24"],
    ["2026-03-01", "2026-02-23"],
  ]) {
    assert.deepEqual(periodDates(today, { kind: "week" }), { from, to: today });
  }
});
