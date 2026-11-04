import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { calendarMonth, pickRangeDate, shiftMonth } from "./calendar-range.js";

const formatDate = (date, options) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(date + "T00:00:00Z"));

export default function DateRangePicker({ value, today, onApply, onClose }) {
  const ref = useRef(null);
  const [month, setMonth] = useState(value.from.slice(0, 7));
  const [range, setRange] = useState({ ...value, phase: "start" });
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const days = range.to
    ? Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
    : 0;
  return (
    <dialog
      ref={ref}
      className="rv-range-dialog"
      aria-labelledby="rv-range-title"
      onClose={onClose}
    >
      <div className="rv-range-panel">
        <div className="rv-range-heading">
          <h2 id="rv-range-title">
            <CalendarDays size={19} />
            Pilih tanggal
          </h2>
          <button
            type="button"
            className="rv-range-icon"
            aria-label="Tutup kalender"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <div className="rv-range-navigation">
          <button
            type="button"
            className="rv-range-icon"
            aria-label="Bulan sebelumnya"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft size={19} />
          </button>
          <span aria-live="polite">
            {range.phase === "start"
              ? "Pilih tanggal awal"
              : "Pilih tanggal akhir"}
          </span>
          <button
            type="button"
            className="rv-range-icon"
            aria-label="Bulan berikutnya"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight size={19} />
          </button>
        </div>
        <div className="rv-range-months">
          {[month, shiftMonth(month, 1)].map((key) => {
            const calendar = calendarMonth(key);
            return (
              <section
                className="rv-range-month"
                key={key}
                aria-label={formatDate(key + "-01", {
                  month: "long",
                  year: "numeric",
                })}
              >
                <h3>
                  {formatDate(key + "-01", { month: "long", year: "numeric" })}
                </h3>
                <div className="rv-range-weekdays" aria-hidden="true">
                  {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(
                    (day) => (
                      <span key={day}>{day}</span>
                    ),
                  )}
                </div>
                <div className="rv-range-days">
                  {Array.from({ length: calendar.offset }, (_, index) => (
                    <span key={"blank" + index} />
                  ))}
                  {calendar.days.map((date) => {
                    const start = date === range.from,
                      end = date === range.to;
                    return (
                      <button
                        type="button"
                        key={date}
                        className={[
                          start && "rv-range-start",
                          end && "rv-range-end",
                          date > range.from &&
                            date < range.to &&
                            "rv-range-between",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-label={formatDate(date, {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        aria-pressed={start || end}
                        aria-current={date === today ? "date" : undefined}
                        onClick={() => setRange(pickRangeDate(range, date))}
                      >
                        {Number(date.slice(-2))}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="rv-range-footer">
          <span aria-live="polite">
            {days ? `${days} hari dipilih` : "Pilih tanggal awal dan akhir"}
          </span>
          <button
            type="button"
            className="rv-range-apply"
            disabled={!range.to}
            onClick={() => onApply({ from: range.from, to: range.to })}
          >
            Terapkan
          </button>
        </div>
      </div>
    </dialog>
  );
}
