import React, { useState } from "react";
import {
  ArrowRight,
  Droplets,
  ChevronDown,
  History,
  Truck,
  Store,
  ClipboardPen,
  CalendarDays,
} from "lucide-react";
import { can, dateLabel, timeLabel } from "./api.js";
import { formatLiters } from "./water-volume.js";
import PeriodFilters from "./period-filters.jsx";
import { periodDates } from "./period-range.js";
import { LoadingState } from "./OverlayDialog.jsx";

export function WaterMenu({ current, canRecord = true }) {
  return (
    <nav className="rv-water-menu" aria-label="Menu kontrol air">
      {canRecord && (
        <a
          href="#watercontrol"
          aria-current={current === "record" ? "page" : undefined}
        >
          <ClipboardPen size={16} aria-hidden="true" /> Catat meter
        </a>
      )}
      <a
        href="#waterreports"
        aria-current={current === "report" ? "page" : undefined}
      >
        <History size={16} aria-hidden="true" /> Laporan
      </a>
    </nav>
  );
}

export function WaterFlow({ group }) {
  const term = (label, value) => (
    <div key={label}>
      <small>{label}</small>
      <strong>{formatLiters(value, 3)}</strong>
    </div>
  );
  return (
    <section className="rv-water-flow" aria-label={"Perhitungan " + group.name}>
      <h4>
        {group.name}
        {group.group === "ro" && <small>RO 1 + RO 2</small>}
      </h4>
      <div className="rv-water-equation rv-water-stock-equation">
        {[
          ["Dijual", group.salesLiters],
          ["+ Stok sisa", group.closingLiters],
          ["− Stok awal", group.openingLiters],
          ["= Seharusnya", group.expectedLiters],
        ].map(([label, value]) => term(label, value))}
      </div>
      <div className="rv-water-equation rv-water-result-equation">
        {[
          ["Meteran", group.usageLiters],
          ["− Seharusnya", group.expectedLiters],
          ["= Selisih", group.differenceLiters],
        ].map(([label, value]) => term(label, value))}
      </div>
    </section>
  );
}
function Metrics({ groups }) {
  if (!groups?.length)
    return <p className="rv-note">Rincian RO dan Mineral belum tersedia.</p>;
  return (
    <table className="rv-water-group-metrics">
      <thead>
        <tr>
          <th scope="col">Air</th>
          <th scope="col">Dijual</th>
          <th scope="col">Meteran</th>
          <th scope="col">Selisih</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.group}>
            <th scope="row">{group.name}</th>
            <td>{formatLiters(group.salesLiters, 3)}</td>
            <td>{formatLiters(group.usageLiters, 3)}</td>
            <td>{formatLiters(group.differenceLiters, 3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function ProductRows({ title, rows, empty }) {
  return (
    <section className="rv-water-product-section">
      <h5>{title}</h5>
      {rows?.length ? (
        <ul className="rv-water-product-list">
          {rows.map(({ name, qty, liters }, index) => (
            <li key={index}>
              <span>
                {qty} × {name}
              </span>
              <b>{formatLiters(liters, 3)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rv-note">{rows ? empty : "Data belum tersedia."}</p>
      )}
    </section>
  );
}
function Activity({ row }) {
  if (!row || !(row.deliveredUnits || row.counterUnits)) return null;
  return (
    <div className="rv-water-activity">
      {row.deliveredUnits > 0 && (
        <span aria-label={row.deliveredUnits + " unit pengantaran"}>
          <Truck size={12} />
          {row.deliveredUnits} unit
          {row.deliveryOrders > 0 && " · " + row.deliveryOrders + " pesanan"}
        </span>
      )}
      {row.counterUnits > 0 && (
        <span aria-label={row.counterUnits + " unit di depot"}>
          <Store size={12} />
          {row.counterUnits} unit
        </span>
      )}
    </div>
  );
}
export function createWaterReports({
  useApp,
  Header,
  usePeriod,
  useResource,
  PhotoButton,
}) {
  function MeterEvidence({ phase, name, value, photoId }) {
    const reading = formatLiters(value);
    return (
      <div className="rv-water-meter-reading">
        <div>
          <small>Meteran {phase}</small>
          <b>{reading}</b>
          {!photoId && <small>Foto tidak tersedia</small>}
        </div>
        {photoId && (
          <PhotoButton
            id={photoId}
            label={`Meteran ${phase} ${name} · ${reading}`}
            className="rv-attendance-photo rv-water-reading-photo"
          />
        )}
      </div>
    );
  }

  function Detail({ id }) {
    const [check, error] = useResource(
      "/water-reports/" + encodeURIComponent(id),
    );
    if (!check)
      return error ? (
        <p className="rv-error" role="alert">
          {error}
        </p>
      ) : (
        <LoadingState compact />
      );
    return (
      <div className="rv-water-report-detail">
        {(check.comparison || []).map((group) => (
          <WaterFlow key={group.group} group={group} />
        ))}
        <section className="rv-water-meter-evidence">
          <h4>Meteran & foto</h4>
          {check.readings.map((meter) => (
            <div key={meter.meterId}>
              <strong>{meter.name}</strong>
              <div className="rv-water-meter-readings">
                <MeterEvidence
                  phase="awal"
                  name={meter.name}
                  value={meter.opening}
                  photoId={meter.openingPhotoId}
                />
                <ArrowRight size={14} aria-hidden="true" />
                <MeterEvidence
                  phase="akhir"
                  name={meter.name}
                  value={meter.closing}
                  photoId={meter.photoId}
                />
                <span className="rv-water-meter-usage">
                  <b>{formatLiters(meter.liters, 3)}</b>
                  <span>terpakai</span>
                </span>
              </div>
            </div>
          ))}
        </section>
        <details className="rv-water-extra">
          <summary>
            Produk & stok
            <ChevronDown size={14} />
          </summary>
          <ProductRows
            title="Produk terjual"
            rows={check.activity?.products}
            empty="Belum ada produk terjual."
          />
          <ProductRows
            title="Produk stok sisa"
            rows={check.stock?.closing
              .filter((row) => row.qty > 0)
              .map((row) => ({
                ...row,
                liters: row.qty * row.capacityLiters,
              }))}
            empty="Tidak ada stok sisa."
          />
          {check.legacy_invoices > 0 && (
            <p className="rv-note">
              {check.legacy_invoices} transaksi tanpa kapasitas.
            </p>
          )}
          {check.ungroupedLiters > 0 && (
            <p className="rv-note">
              {formatLiters(check.ungroupedLiters, 3)} di luar RO/Mineral.
            </p>
          )}
        </details>
      </div>
    );
  }
  function Shift({ row }) {
    const [open, setOpen] = useState(false);
    return (
      <article className="rv-card rv-water-report-shift">
        <button
          type="button"
          className="rv-water-report-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={
            dateLabel(row.startAt) +
            " " +
            timeLabel(row.startAt) +
            " → " +
            dateLabel(row.closedAt) +
            " " +
            timeLabel(row.closedAt) +
            " WIB"
          }
        >
          <b className="rv-water-shift-badge">
            {row.shiftNumber ? "Shift " + row.shiftNumber : "Arsip"}
          </b>
          <span>
            <strong>{row.actor}</strong>
            <small>
              {dateLabel(row.shiftDate || row.closedAt)} · Tutup{" "}
              {timeLabel(row.closedAt)}
            </small>
          </span>
          <ChevronDown size={16} />
        </button>
        <Metrics groups={row.groups} />
        <Activity row={row.activity} />
        {open && <Detail id={row.id} />}
      </article>
    );
  }
  function Pagination({ report, onPage }) {
    const { offset, rows, total, hasMore } = report;
    if (!offset && !hasMore) return null;
    return (
      <div className="rv-report-pagination">
        <button
          disabled={!offset}
          onClick={() => onPage(Math.max(0, offset - 30))}
        >
          Sebelumnya
        </button>
        <span>
          {rows.length ? offset + 1 : 0}–{offset + rows.length} / {total}
        </span>
        <button disabled={!hasMore} onClick={() => onPage(offset + 30)}>
          Berikutnya
        </button>
      </div>
    );
  }

  function ReportSummary({ summary, title, label }) {
    return (
      <section className="rv-card rv-water-report-summary" aria-label={label}>
        <header className="rv-water-summary-heading">
          <strong>{title}</strong>
          <span>{summary.shiftCount} shift</span>
        </header>
        <Metrics groups={summary.groups} />
        <Activity row={summary} />
        {summary.legacyInvoices > 0 && (
          <small className="rv-note">Data kapasitas belum lengkap</small>
        )}
        {summary.legacyCount > 0 && (
          <small className="rv-note">
            {summary.legacyCount} catatan lama di luar akumulasi
          </small>
        )}
      </section>
    );
  }

  function ShiftList({ report, onPage, daily = false }) {
    const { summary, rows } = report;
    return (
      <>
        <ReportSummary
          summary={summary}
          title={daily ? "Ringkasan harian" : "Ringkasan"}
          label={
            daily ? "Ringkasan harian kontrol air" : "Akumulasi kontrol air"
          }
        />
        {rows.map((row) => (
          <Shift key={row.id} row={row} />
        ))}
        {!rows.length && <p className="rv-note">Belum ada laporan.</p>}
        <Pagination report={report} onPage={onPage} />
      </>
    );
  }

  function DayShifts({ day, actorQuery }) {
    const [offset, setOffset] = useState(0);
    const [report, error] = useResource(
      `/water-reports?from=${day}&to=${day}&offset=${offset}${actorQuery}`,
    );
    if (error)
      return (
        <p className="rv-error" role="alert">
          {error}
        </p>
      );
    if (!report) return <LoadingState compact />;
    return <ShiftList report={report} onPage={setOffset} daily />;
  }

  function ReportDay({ row, actorQuery }) {
    const [open, setOpen] = useState(false);
    return (
      <section className="rv-water-report-day">
        <button
          type="button"
          className="rv-water-report-day-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <CalendarDays size={16} aria-hidden="true" />
          <strong>
            {dateLabel(row.day)} {row.day.slice(0, 4)}
          </strong>
          <small>{row.count} catatan</small>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open && <DayShifts day={row.day} actorQuery={actorQuery} />}
      </section>
    );
  }

  return function WaterReports() {
    const { data } = useApp();
    const [period, setPeriod, query] = usePeriod("today");
    const [actor, setActor] = useState("");
    const [offset, setOffset] = useState(0);
    const { from, to } = periodDates(data.today, period);
    const multipleDays = from !== to;
    const actorQuery = actor ? "&actor=" + encodeURIComponent(actor) : "";
    const [report, error] = useResource(
      `/water-reports?${query}&offset=${offset}${actorQuery}${multipleDays ? "&by=day" : ""}`,
    );
    return (
      <>
        <Header
          title="Kontrol air"
          icon={Droplets}
          back="other"
          className="rv-reports-header"
          filters={
            <>
              <WaterMenu
                current="report"
                canRecord={can(data.user, "waterControl")}
              />
              <PeriodFilters
                value={period}
                onChange={(value) => {
                  setPeriod(value);
                  setOffset(0);
                }}
                today={data.today}
                label="Periode laporan kontrol air"
              />
            </>
          }
        />
        <main className="rv-body rv-feature rv-water-reports-body">
          {error && (
            <p className="rv-error" role="alert">
              {error}
            </p>
          )}
          {!report && !error && <LoadingState />}
          {report && (
            <>
              <div className="rv-section-heading">
                <h3>
                  <History size={15} /> Riwayat shift
                </h3>
                <select
                  aria-label="Filter akun penutup shift"
                  value={actor}
                  onChange={(e) => {
                    setActor(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">Semua akun</option>
                  {report.actors.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              {report.summary ? (
                <ShiftList
                  key={query + actor}
                  report={report}
                  onPage={setOffset}
                />
              ) : (
                <>
                  {report.periodSummary && (
                    <ReportSummary
                      summary={report.periodSummary}
                      title="Ringkasan periode"
                      label="Ringkasan periode kontrol air"
                    />
                  )}
                  {report.rows.map((row) => (
                    <ReportDay
                      key={query + actor + row.day}
                      row={row}
                      actorQuery={actorQuery}
                    />
                  ))}
                  {!report.rows.length && (
                    <p className="rv-note">Belum ada laporan.</p>
                  )}
                  <Pagination report={report} onPage={setOffset} />
                </>
              )}
            </>
          )}
        </main>
      </>
    );
  };
}
