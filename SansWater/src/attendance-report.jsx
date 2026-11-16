import React, { useState } from "react";
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
} from "lucide-react";
import PeriodFilters from "./period-filters.jsx";
import { dateLabel, timeLabel } from "./api.js";
import Empty from "./EmptyState.jsx";
import { LoadingState } from "./OverlayDialog.jsx";

function attendanceDays(rows) {
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.day)) days.set(row.day, []);
    days.get(row.day).push(row);
  }
  return Array.from(days);
}

function ShiftGroups({ rows, PhotoButton }) {
  const groups = [
    { shift: 1, label: "Shift 1" },
    { shift: 2, label: "Shift 2" },
    { shift: null, label: "Tanpa keterangan shift" },
  ];
  return (
    <div className="rv-attendance-shift-groups">
      {groups.map(({ shift, label }) => {
        const entries = rows.filter((row) =>
          shift === null ? ![1, 2].includes(row.shift) : row.shift === shift,
        );
        if (!entries.length) return null;
        return (
          <section
            className={
              "rv-attendance-shift-group" + (shift === 2 ? " is-second" : "")
            }
            key={shift ?? "legacy"}
            aria-label={label}
          >
            <h5 className="rv-attendance-shift-heading">
              <span>
                <Clock size={12} />
                {label}
              </span>
              <span>{entries.length} catatan</span>
            </h5>
            <div className="rv-attendance-shift-entries">
              {entries.map((row) => (
                <div
                  className={
                    "rv-attendance-entry" +
                    (row.shift === 2 ? " is-second" : "")
                  }
                  key={row.id}
                >
                  <span className="rv-attendance-avatar" aria-hidden="true">
                    {row.name.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div className="rv-attendance-entry-person">
                    <strong>{row.name}</strong>
                    <span className="rv-attendance-shift-tag">
                      <CheckCircle2 size={10} />
                      Sudah absen
                    </span>
                  </div>
                  <time
                    className="rv-attendance-entry-time"
                    dateTime={row.created_at}
                  >
                    <span>
                      <Clock size={11} />
                      {timeLabel(row.created_at)}
                    </span>
                    <small>WIB</small>
                  </time>
                  {row.photo_id ? (
                    <PhotoButton
                      id={row.photo_id}
                      label={
                        "Foto absensi " +
                        row.name +
                        " · " +
                        dateLabel(row.day) +
                        (row.shift ? " · Shift " + row.shift : "") +
                        " · " +
                        timeLabel(row.created_at) +
                        " WIB"
                      }
                    />
                  ) : (
                    <span className="rv-attendance-caption">Tanpa foto</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AttendancePagination({ report, offset, onChange, label }) {
  if (!offset && !report?.hasMore) return null;
  return (
    <nav className="rv-attendance-pagination" aria-label={label}>
      <button
        type="button"
        disabled={!offset || !report}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >
        <ChevronLeft size={15} />
        Sebelumnya
      </button>
      <span>
        {report
          ? `${offset + 1}–${offset + report.rows.length} dari ${report.total}`
          : "Memuat…"}
      </span>
      <button
        type="button"
        disabled={!report?.hasMore}
        onClick={() => onChange(offset + 50)}
      >
        Berikutnya
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}

export function createAttendanceReport({
  useApp,
  usePeriod,
  useResource,
  Header,
  PhotoButton,
}) {
  function EmployeeAttendance({ employee, query }) {
    const [offset, setOffset] = useState(0);
    const [expandedDay, setExpandedDay] = useState(null);
    const [report, error] = useResource(
      "/attendance?" +
        query +
        "&actor=" +
        encodeURIComponent(employee.user_id) +
        "&offset=" +
        offset,
    );
    return (
      <div
        className="rv-attendance-account-details"
        role="region"
        id={"attendance-account-" + employee.user_id}
        aria-labelledby={"attendance-account-toggle-" + employee.user_id}
        aria-busy={!report && !error}
      >
        {error && (
          <p className="rv-error" role="alert">
            {error}
          </p>
        )}
        {!report && !error && <LoadingState compact />}
        {report && !report.rows.length && (
          <Empty icon={CalendarDays} compact>
            Belum ada absensi pada periode ini.
          </Empty>
        )}
        {attendanceDays(report?.rows || []).map(([day, rows]) => (
          <section className="rv-attendance-account-day" key={day}>
            <h4>
              <button
                type="button"
                className="rv-attendance-day-heading"
                id={`attendance-account-day-toggle-${employee.user_id}-${day}`}
                aria-expanded={expandedDay === day}
                aria-controls={`attendance-account-day-entries-${employee.user_id}-${day}`}
                onClick={() => setExpandedDay(expandedDay === day ? null : day)}
              >
                <span>
                  <CalendarDays size={13} />
                  {dateLabel(day)}
                </span>
                <span>
                  {rows.length}{" "}
                  {report.total > 50 ? "di halaman ini" : "catatan"}
                </span>
                <ChevronDown size={16} />
              </button>
            </h4>
            {expandedDay === day && (
              <div
                className="rv-attendance-day-entries"
                id={`attendance-account-day-entries-${employee.user_id}-${day}`}
                role="region"
                aria-labelledby={`attendance-account-day-toggle-${employee.user_id}-${day}`}
              >
                <ShiftGroups rows={rows} PhotoButton={PhotoButton} />
              </div>
            )}
          </section>
        ))}
        <AttendancePagination
          report={report}
          offset={offset}
          onChange={(nextOffset) => {
            setOffset(nextOffset);
            setExpandedDay(null);
          }}
          label={"Halaman absensi " + employee.name}
        />
      </div>
    );
  }

  return function AttendanceReport() {
    const { data } = useApp();
    const [period, setPeriod, query] = usePeriod();
    const [offset, setOffset] = useState(0);
    const [expandedEmployee, setExpandedEmployee] = useState("");
    const [expandedDay, setExpandedDay] = useState(null);
    const [overview, overviewError] = useResource("/attendance?" + query);
    const [page, pageError] = useResource(
      offset ? "/attendance?" + query + "&offset=" + offset : null,
    );
    const report = offset ? page : overview;
    const error = offset ? pageError : overviewError;
    const summary = overview?.summary || [];
    const multiDay = overview && overview.from !== overview.to;
    const employees = [...summary].sort((a, b) =>
      a.name.localeCompare(b.name, "id"),
    );
    const days = attendanceDays(report?.rows || []);
    function changePage(nextOffset) {
      setOffset(nextOffset);
      setExpandedDay(null);
    }
    const periodName = {
      today: "Hari ini",
      yesterday: "Kemarin",
      week: "Minggu ini",
      month: "Bulan ini",
      range: "Periode pilihan",
      all: "Semua periode",
    }[period.kind];
    const formatDate = (day) =>
      new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Jakarta",
      }).format(new Date(day + "T00:00:00+07:00"));
    const periodLabel =
      overview &&
      (overview.from === overview.to
        ? formatDate(overview.from)
        : (overview.from.slice(0, 4) === overview.to.slice(0, 4)
            ? dateLabel(overview.from)
            : formatDate(overview.from)) +
          " – " +
          formatDate(overview.to));
    const periodDays =
      overview &&
      Math.round(
        (Date.parse(overview.to) - Date.parse(overview.from)) / 86400000,
      ) + 1;
    return (
      <>
        <Header
          title="Rekap absensi"
          icon={Camera}
          back="other"
          className="rv-attendance-header"
          filters={
            <PeriodFilters
              value={period}
              today={data.today}
              onChange={(value) => {
                setPeriod(value);
                setOffset(0);
                setExpandedEmployee("");
                setExpandedDay(null);
              }}
            />
          }
        />
        <main className="rv-body rv-feature rv-attendance-report">
          {overviewError && (
            <p className="rv-error" role="alert">
              {overviewError}
            </p>
          )}
          {!overview && !overviewError && <LoadingState />}
          {overview && (
            <>
              <section
                className="rv-card rv-attendance-overview"
                aria-labelledby="attendance-overview-title"
              >
                <header className="rv-attendance-section-title">
                  <h3 id="attendance-overview-title">
                    <CalendarDays size={17} />
                    Ringkasan absensi
                  </h3>
                  <span className="rv-attendance-count">{periodName}</span>
                </header>
                <div className="rv-attendance-period">
                  <span className="rv-attendance-period-icon">
                    <CalendarDays size={18} />
                  </span>
                  <span className="rv-attendance-period-copy">
                    <small>PERIODE ABSENSI</small>
                    <strong>{periodLabel}</strong>
                  </span>
                  <span className="rv-attendance-period-duration">
                    {periodDays} hari
                  </span>
                </div>
                <div className="rv-attendance-metrics">
                  <div>
                    <span className="rv-attendance-metric-label">
                      <Users size={16} />
                      <span>Karyawan hadir</span>
                    </span>
                    <span className="rv-attendance-metric-value">
                      <strong>{summary.length}</strong>
                      <span>orang</span>
                    </span>
                  </div>
                  <div>
                    <span className="rv-attendance-metric-label">
                      <CheckCircle2 size={16} />
                      <span>Catatan masuk</span>
                    </span>
                    <span className="rv-attendance-metric-value">
                      <strong>{overview.total}</strong>
                      <span>catatan</span>
                    </span>
                  </div>
                  <div aria-label="Total hari hadir seluruh karyawan">
                    <span className="rv-attendance-metric-label">
                      <CalendarDays size={16} />
                      <span>Total hari hadir</span>
                    </span>
                    <span className="rv-attendance-metric-value">
                      <strong>
                        {summary.reduce((total, row) => total + row.days, 0)}
                      </strong>
                      <span>hari</span>
                    </span>
                  </div>
                </div>
              </section>
              <section
                className="rv-card rv-attendance-history"
                aria-labelledby="attendance-history-title"
                aria-busy={!report && !error}
              >
                <header className="rv-attendance-section-title">
                  <h3 id="attendance-history-title">
                    <Clock size={16} />
                    Riwayat kehadiran
                  </h3>
                  <span className="rv-attendance-count">
                    {report ? report.total + " catatan" : "Memuat…"}
                  </span>
                </header>
                {multiDay && (
                  <div className="rv-attendance-history-filter">
                    <span>Tanggal terbaru lebih dahulu</span>
                  </div>
                )}
                {error && (
                  <p className="rv-error" role="alert">
                    {error}
                  </p>
                )}
                {!report && !error && <LoadingState />}
                {!multiDay && !!report?.rows.length && (
                  <div className="rv-attendance-daily">
                    <div className="rv-attendance-daily-date">
                      <CalendarDays size={13} />
                      {dateLabel(report.from)}
                      {report.from === data.today ? " · Hari ini" : ""}
                    </div>
                    <ShiftGroups rows={report.rows} PhotoButton={PhotoButton} />
                  </div>
                )}
                {multiDay &&
                  days.map(([day, rows]) => (
                    <div className="rv-attendance-day" key={day}>
                      <button
                        type="button"
                        className="rv-attendance-day-heading"
                        id={"attendance-day-toggle-" + day}
                        aria-expanded={expandedDay === day}
                        aria-controls={"attendance-day-entries-" + day}
                        onClick={() =>
                          setExpandedDay(expandedDay === day ? null : day)
                        }
                      >
                        <span>
                          <CalendarDays size={13} />
                          {dateLabel(day)}
                          {day === data.today ? " · Hari ini" : ""}
                        </span>
                        <span>
                          {rows.length}{" "}
                          {report.total > 50 ? "di halaman ini" : "catatan"}
                        </span>
                        <ChevronDown size={16} />
                      </button>
                      {expandedDay === day && (
                        <div
                          className="rv-attendance-day-entries"
                          id={"attendance-day-entries-" + day}
                          role="region"
                          aria-labelledby={"attendance-day-toggle-" + day}
                        >
                          <ShiftGroups rows={rows} PhotoButton={PhotoButton} />
                        </div>
                      )}
                    </div>
                  ))}
                {report && !report.rows.length && (
                  <Empty icon={Camera} compact>
                    Belum ada absensi pada periode ini.
                  </Empty>
                )}
                {multiDay && !!report?.rows.length && (
                  <p className="rv-attendance-caption">
                    Pilih tanggal untuk melihat shift, waktu, dan foto absensi.
                  </p>
                )}
                <AttendancePagination
                  report={report}
                  offset={offset}
                  onChange={changePage}
                  label="Halaman riwayat absensi"
                />
              </section>
              {multiDay && (
                <section
                  className="rv-card rv-attendance-employees"
                  aria-labelledby="attendance-employees-title"
                >
                  <header className="rv-attendance-section-title">
                    <h3 id="attendance-employees-title">
                      <Users size={16} />
                      Rekap per karyawan
                    </h3>
                    <span className="rv-attendance-count">
                      {summary.length} orang
                    </span>
                  </header>
                  {!!employees.length && (
                    <div className="rv-attendance-employee-list">
                      {employees.map((row) => (
                        <article
                          className="rv-attendance-employee"
                          key={row.user_id}
                        >
                          <button
                            type="button"
                            className="rv-attendance-employee-toggle"
                            id={"attendance-account-toggle-" + row.user_id}
                            aria-expanded={expandedEmployee === row.user_id}
                            aria-controls={"attendance-account-" + row.user_id}
                            onClick={() =>
                              setExpandedEmployee(
                                expandedEmployee === row.user_id
                                  ? ""
                                  : row.user_id,
                              )
                            }
                          >
                            <span className="rv-attendance-employee-header">
                              <span
                                className="rv-attendance-avatar"
                                aria-hidden="true"
                              >
                                {row.name.trim().slice(0, 1).toUpperCase()}
                              </span>
                              <span className="rv-attendance-employee-name">
                                <strong>{row.name}</strong>
                                <span className="rv-attendance-employee-stats">
                                  <span>
                                    <CalendarDays size={11} />
                                    <b>{row.days}</b> hari hadir
                                  </span>
                                  <span>
                                    <CheckCircle2 size={11} />
                                    <b>{row.entries}</b> kali masuk
                                  </span>
                                </span>
                              </span>
                              <ChevronDown size={16} />
                            </span>
                          </button>
                          {expandedEmployee === row.user_id && (
                            <EmployeeAttendance
                              key={query + row.user_id}
                              employee={row}
                              query={query}
                            />
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                  {!employees.length && (
                    <Empty icon={Users} compact>
                      Belum ada kehadiran pada periode ini.
                    </Empty>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </>
    );
  };
}
