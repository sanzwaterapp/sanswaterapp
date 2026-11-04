import React, { useState } from "react";
import { CalendarDays } from "lucide-react";
import DateRangePicker from "./date-range-picker.jsx";
import { periodDates } from "./period-range.js";
import { dateLabel } from "./api.js";

export default function PeriodFilters({
  value,
  onChange,
  today,
  label = "Periode",
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  return (
    <>
      <div className="rv-period-controls">
        <div className="rv-period-buttons" role="group" aria-label={label}>
          {[
            ["today", "Hari ini"],
            ["yesterday", "Kemarin"],
            ["week", "Minggu ini"],
            ["month", "Bulan ini"],
            ["range", "Custom"],
          ].map(([kind, text]) => (
            <button
              type="button"
              key={kind}
              aria-pressed={value.kind === kind}
              aria-haspopup={kind === "range" ? "dialog" : undefined}
              aria-expanded={kind === "range" ? calendarOpen : undefined}
              onClick={() =>
                kind === "range"
                  ? setCalendarOpen(true)
                  : onChange({ ...value, kind })
              }
            >
              {text}
            </button>
          ))}
        </div>
        {value.kind === "range" && (
          <button
            type="button"
            className="rv-period-range-label"
            aria-label="Ubah rentang tanggal"
            onClick={() => setCalendarOpen(true)}
          >
            <CalendarDays size={13} /> {dateLabel(value.from)} –{" "}
            {dateLabel(value.to)}
          </button>
        )}
      </div>
      {calendarOpen && (
        <DateRangePicker
          today={today}
          value={periodDates(today, value)}
          onClose={() => setCalendarOpen(false)}
          onApply={(range) => {
            onChange({ ...value, ...range, kind: "range" });
            setCalendarOpen(false);
          }}
        />
      )}
    </>
  );
}
