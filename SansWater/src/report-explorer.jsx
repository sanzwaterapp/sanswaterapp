import React, { useState } from "react";
import {
  ChevronDown,
  Truck,
  Store,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  Banknote,
  ScanLine,
  Calculator,
  X,
} from "lucide-react";
import { api, money, dateLabel, timeLabel } from "./api.js";
import AppForm from "./AppForm.jsx";
import { LoadingState } from "./OverlayDialog.jsx";
import PeriodFilters from "./period-filters.jsx";
import { formatLiters } from "./water-volume.js";
import PaymentReceipt, {
  paymentLabels,
  ReceiptButton,
} from "./PaymentReceipt.jsx";

export function createPayroll({
  useApp,
  Header,
  usePeriod,
  useResource,
  Field,
  Submit,
}) {
  const components = [
    ["roShift1", "RO · Shift 1"],
    ["mineralShift1", "Mineral · Shift 1"],
    ["roShift2", "RO · Shift 2"],
    ["mineralShift2", "Mineral · Shift 2"],
  ];
  const number = (value) =>
    Number(value).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  function Editor({ result }) {
    const { act, busy } = useApp();
    const [draft, setDraft] = useState(result.config);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const drivers = result.rows.filter(
      (row) =>
        row.components.delivery.liters > 0 || row.components.delivery.items > 0,
    );
    const totals = new Map();
    function amount(item, units, listed = true) {
      const total = item?.actor
        ? Math.round(units * Number(item.rate || 0))
        : 0;
      if (item?.actor && listed)
        totals.set(item.actor, (totals.get(item.actor) || 0) + total);
      return total;
    }
    const meterAmounts = Object.fromEntries(
      components.map(([key]) => [
        key,
        amount(draft.meters[key], result.summary[key].liters / 19),
      ]),
    );
    const driverAmounts = Object.fromEntries(
      drivers.map((driver) => [
        driver.id,
        amount(
          { actor: driver.id, rate: draft.drivers[driver.id]?.rate || 0 },
          driver.components.delivery.liters / 19 +
            (driver.components.delivery.items || 0),
          Object.hasOwn(draft.drivers, driver.id),
        ),
      ]),
    );
    async function clearAccount(id) {
      setError("");
      setNotice("");
      try {
        const saved = await act(() =>
          api("/payroll/config/" + id + "/clear", {
            method: "PATCH",
            body: { version: draft.version },
          }),
        );
        setDraft((current) => ({
          ...current,
          version: saved.version,
          meters: Object.fromEntries(
            Object.entries(current.meters).map(([key, item]) => [
              key,
              item.actor === id ? { actor: "", rate: 0 } : item,
            ]),
          ),
          drivers: Object.fromEntries(
            Object.entries(current.drivers).filter(([driver]) => driver !== id),
          ),
        }));
        setNotice(
          "Pengaturan gaji " +
            result.actors.find((user) => user.id === id)?.name +
            " dihapus.",
        );
      } catch (err) {
        setError(err.message);
      }
    }
    function fields(label, item, onChange) {
      return (
        <div className="rv-payroll-variable-fields">
          <label className="rv-field">
            <span>Penanggung jawab</span>
            <select
              aria-label={label + " · penanggung jawab"}
              value={item.actor}
              onChange={(event) =>
                onChange({ ...item, actor: event.target.value })
              }
            >
              <option value="">Pilih akun</option>
              {result.actors
                .filter((user) => user.active || user.id === item.actor)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          </label>
          <Field
            label="Rp / galon"
            aria-label={label + " · Rp per galon"}
            type="number"
            inputMode="numeric"
            min="0"
            max="10000000"
            step="1"
            required
            value={item.rate}
            onChange={(event) =>
              onChange({ ...item, rate: event.target.value })
            }
          />
        </div>
      );
    }
    return (
      <AppForm
        className="rv-stack rv-payroll-variable-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setNotice("");
          const numeric = (items) =>
            Object.fromEntries(
              Object.entries(items).map(([key, item]) => [
                key,
                { ...item, rate: Number(item.rate) },
              ]),
            );
          try {
            const saved = await act(() =>
              api("/payroll/config", {
                method: "PATCH",
                body: {
                  version: draft.version,
                  meters: numeric(draft.meters),
                  drivers: Object.fromEntries(
                    Object.entries(numeric(draft.drivers)).map(([id, item]) => [
                      id,
                      { ...item, actor: id },
                    ]),
                  ),
                },
              }),
            );
            setDraft(saved);
            setNotice("Pengaturan tersimpan.");
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <div
          className="rv-payroll-volumes rv-payroll-editable"
          aria-label="Perhitungan payroll"
        >
          {[1, 2].map((shift) => (
            <section
              className="rv-card rv-payroll-shift-block"
              aria-label={"Shift " + shift}
              key={shift}
            >
              <h4>Shift {shift}</h4>
              <div className="rv-payroll-shift-grid">
                {components
                  .filter(([key]) => key.endsWith(String(shift)))
                  .map(([key, label]) => (
                    <div
                      key={key}
                      className={"rv-payroll-volume rv-payroll-" + key}
                    >
                      <header className="rv-payroll-product-heading">
                        {key.startsWith("ro") ? (
                          <>
                            RO{" "}
                            <small className="rv-payroll-ro-description">
                              (RO1 + RO2)
                            </small>
                          </>
                        ) : (
                          "Mineral"
                        )}
                      </header>
                      <strong>
                        {number(result.summary[key].gallons)}{" "}
                        <small>galon</small>
                      </strong>
                      <small className="rv-payroll-liter-chip">
                        {formatLiters(result.summary[key].liters, 3)}
                      </small>
                      {fields(label, draft.meters[key], (item) =>
                        setDraft({
                          ...draft,
                          meters: { ...draft.meters, [key]: item },
                        }),
                      )}
                      <div className="rv-payroll-variable-result">
                        <span>Gaji</span>
                        <strong>{money(meterAmounts[key])}</strong>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))}
          <section
            className="rv-card rv-payroll-shift-block rv-payroll-delivery-block"
            aria-label="Antar"
          >
            <h4>
              <Truck size={13} />
              Antar
            </h4>
            <div className="rv-payroll-driver-cards">
              {drivers.map((driver) => (
                <article
                  className="rv-payroll-driver-variable rv-payroll-volume rv-payroll-delivery"
                  key={driver.id}
                  aria-label={"Pengantaran " + driver.name}
                >
                  <header className="rv-payroll-product-heading">
                    <strong>{driver.name}</strong>
                  </header>
                  <div className="rv-payroll-driver-rate">
                    <Field
                      label="Rp / galon atau item"
                      aria-label={
                        "Antar " + driver.name + " · Rp per galon atau item"
                      }
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="10000000"
                      step="1"
                      required
                      value={draft.drivers[driver.id]?.rate ?? 0}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          drivers: {
                            ...draft.drivers,
                            [driver.id]: {
                              actor: driver.id,
                              rate: event.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div className="rv-payroll-delivery-formula">
                    <span>
                      {number(driver.components.delivery.gallons)} galon +{" "}
                      {number(driver.components.delivery.items || 0)} item
                    </span>
                    <span>=</span>
                    <strong>{money(driverAmounts[driver.id])}</strong>
                  </div>
                </article>
              ))}
              {!drivers.length && <small>Belum ada pengantaran.</small>}
            </div>
          </section>
        </div>
        {error && (
          <p role="alert" className="rv-error">
            {error}
          </p>
        )}
        <Submit>Simpan pengaturan</Submit>
        {notice && (
          <p className="rv-note" role="status">
            {notice}
          </p>
        )}
        <section
          className="rv-card rv-payroll-salary-summary"
          aria-label="Jumlah gaji karyawan"
        >
          <div className="rv-section-heading">
            <h3>Jumlah gaji</h3>
            <strong>
              {money(
                Array.from(totals.values()).reduce(
                  (sum, total) => sum + total,
                  0,
                ),
              )}
            </strong>
          </div>
          <dl>
            {Array.from(totals, ([id, total]) => (
              <div key={id}>
                <dt>
                  {result.actors.find((user) => user.id === id)?.name || "Akun"}
                </dt>
                <dd>
                  <strong>{money(total)}</strong>
                  <button
                    type="button"
                    className="rv-payroll-clear"
                    disabled={busy}
                    aria-label={
                      "Hapus pengaturan gaji " +
                      (result.actors.find((user) => user.id === id)?.name ||
                        "akun")
                    }
                    onClick={() => clearAccount(id)}
                  >
                    <X size={14} />
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </AppForm>
    );
  }
  return function Payroll() {
    const { data } = useApp();
    const [period, setPeriod, query] = usePeriod("month");
    const [result, error] = useResource("/payroll?" + query);
    return (
      <>
        <Header
          title="Payroll"
          icon={Calculator}
          className="rv-reports-header"
          filters={
            <PeriodFilters
              value={period}
              onChange={setPeriod}
              today={data.today}
              label="Periode payroll"
            />
          }
        />
        <main className="rv-body rv-feature rv-payroll-body">
          {error && (
            <p className="rv-error" role="alert">
              {error}
            </p>
          )}
          {!result && !error && <LoadingState />}
          {result && <Editor key={query} result={result} />}
        </main>
      </>
    );
  };
}
export function ExpenseLines({ rows }) {
  if (!rows.length) return null;
  return (
    <dl className="rv-report-sources rv-expense-cash-lines">
      {rows.map((row) => (
        <div key={row.id}>
          <dt>
            <ArrowUp
              size={13}
              className="rv-cash-out"
              aria-label="Uang keluar"
            />
            <span>{row.note?.trim() || row.description}</span>
          </dt>
          <dd className="rv-cash-out">{money(row.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function CashMethodDetails({ methods, expenses }) {
  return methods.map(
    ({
      method,
      sales,
      debt,
      net,
      expense = 0,
      transferIn = 0,
      transferOut = 0,
    }) => (
      <div className="rv-receipt-method" data-method={method} key={method}>
        <strong className="rv-receipt-method-label">
          {method === "Tunai" ? <Banknote size={13} /> : <ScanLine size={13} />}{" "}
          {method}
        </strong>
        {(sales > 0 ||
          debt > 0 ||
          expense > 0 ||
          transferIn > 0 ||
          transferOut > 0) && (
          <dl className="rv-report-sources">
            {[
              ["Penjualan", sales, false],
              ["Bayar hutang", debt, false],
              ["Pengeluaran", expense, true],
              ["Perpindahan masuk", transferIn, false],
              ["Perpindahan keluar", transferOut, true],
            ]
              .filter(([, amount]) => amount > 0)
              .map(([label, amount, outgoing]) => (
                <div key={label}>
                  <dt>
                    {outgoing ? (
                      <ArrowUp size={13} className="rv-cash-out" />
                    ) : (
                      <ArrowDown size={13} className="rv-cash-in" />
                    )}
                    {label}
                  </dt>
                  <dd className={outgoing ? "rv-cash-out" : ""}>
                    {money(amount)}
                  </dd>
                </div>
              ))}
          </dl>
        )}
        <ExpenseLines rows={expenses.filter((row) => row.method === method)} />
        <div className="rv-staff-cash-net">
          <span>Sisa {method}</span>
          <strong>{money(net)}</strong>
        </div>
      </div>
    ),
  );
}

export function createCashFlowList({ useResource }) {
  return function CashFlowList({ query, actor, fund, children }) {
    const [offset, setOffset] = useState(0),
      [result, error] = useResource(
        "/report-cashflow?" +
          query +
          "&kind=expense&offset=" +
          offset +
          (actor ? "&actor=" + encodeURIComponent(actor) : "") +
          (fund ? "&fund=" + encodeURIComponent(fund) : ""),
      );
    if (!result)
      return error ? (
        <p className="rv-error" role="alert">
          {error}
        </p>
      ) : (
        <LoadingState compact />
      );
    return (
      <div className="rv-cash-expense-list">
        {children ? children(result.rows) : <ExpenseLines rows={result.rows} />}
        {(offset > 0 || result.hasMore) && (
          <div className="rv-report-pagination">
            <button
              type="button"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >
              Sebelumnya
            </button>
            <span>
              {offset + 1}–{offset + result.rows.length} / {result.total}{" "}
              pengeluaran
            </span>
            <button
              type="button"
              disabled={!result.hasMore}
              onClick={() => setOffset(offset + 30)}
            >
              Berikutnya
            </button>
          </div>
        )}
      </div>
    );
  };
}

export function createReportExplorer(UI, { transactionsOnly = false } = {}) {
  const { useApp, useResource, Identity, PhotoButton, Empty } = UI;
  const prefix = transactionsOnly ? "/transactions/" : "/report-";
  const listPath = transactionsOnly ? "/transactions" : "/report-transactions";
  const encoded = (query, values) =>
    query + "&" + new URLSearchParams(values).toString();
  function Pending({ error }) {
    return error ? (
      <p className="rv-error" role="alert">
        {error}
      </p>
    ) : (
      <LoadingState compact />
    );
  }
  function Detail({
    id,
    customer,
    showItems,
    showReceipt,
    onOpenReceipt,
    onCloseReceipt,
  }) {
    const { data } = useApp();
    const [row, error] = useResource(listPath + "/" + encodeURIComponent(id));
    return (
      <>
        {showItems && !row && <Pending error={error} />}
        {showItems && row && (
          <div className="rv-report-items" aria-label="Rincian transaksi">
            <ul className="rv-report-item-list">
              {row.items.map((line, index) => (
                <li className="rv-report-item" key={index}>
                  <span className="rv-report-item-name">
                    <span>
                      {line.qty}× {line.name}
                    </span>
                    <small>
                      {" "}
                      · {line.mode} · {money(line.price)}/unit
                    </small>
                  </span>
                  <span className="rv-report-item-amount">
                    {money(line.qty * line.price)}
                  </span>
                </li>
              ))}
            </ul>
            {!!(row.discount || row.shipping) && (
              <dl className="rv-report-detail-fees">
                {!!row.discount && (
                  <div>
                    <dt>Diskon</dt>
                    <dd>−{money(row.discount)}</dd>
                  </div>
                )}
                {!!row.shipping && (
                  <div>
                    <dt>Ongkir</dt>
                    <dd>{money(row.shipping)}</dd>
                  </div>
                )}
              </dl>
            )}
            {!transactionsOnly && (
              <ReceiptButton customer={customer} onClick={onOpenReceipt} />
            )}
          </div>
        )}
        {showReceipt && (
          <PaymentReceipt
            receipt={row}
            depotName={data.settings.name}
            onClose={onCloseReceipt}
            error={error}
          />
        )}
      </>
    );
  }
  function Transaction({ row }) {
    const [open, setOpen] = useState(false);
    const [showReceipt, setShowReceipt] = useState(false);
    const methods = paymentLabels(
      row.payment_methods?.split(","),
      row.total > row.paid,
    );
    const differentDay =
      row.received_at &&
      dateLabel(row.received_at) !== dateLabel(row.recorded_at);
    const orderTime = row.received_at && (
      <time dateTime={row.received_at}>
        Pesan{" "}
        {transactionsOnly && differentDay && dateLabel(row.received_at) + " · "}
        {timeLabel(row.received_at)}
        {!transactionsOnly && " WIB"}
      </time>
    );
    return (
      <div
        className={
          "rv-report-transaction" +
          (transactionsOnly ? " rv-transaction-card" : "")
        }
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="rv-report-transaction-top">
            <Identity code={row.customer_code} name={row.customer_name} />

            {!transactionsOnly && !!(row.shipping || row.discount) && (
              <span className="rv-report-transaction-fees">
                {!!row.shipping && (
                  <span>
                    Ongkir <b>{money(row.shipping)}</b>
                  </span>
                )}
                {!!row.discount && (
                  <span>
                    Diskon <b>−{money(row.discount)}</b>
                  </span>
                )}
              </span>
            )}
            <strong>{money(row.total)}</strong>
            <ChevronDown size={15} />
          </span>
          {!transactionsOnly && (
            <span className="rv-transaction-meta">
              {orderTime}
              {methods && <strong>{methods}</strong>}
            </span>
          )}
        </button>
        {transactionsOnly && (
          <div className="rv-transaction-card-meta">
            <div className="rv-transaction-meta">
              {orderTime}
              <time dateTime={row.recorded_at}>
                Selesai {timeLabel(row.recorded_at)}
              </time>
            </div>
            {methods && (
              <span className="rv-transaction-method">{methods}</span>
            )}
            <ReceiptButton
              customer={row.customer_name}
              onClick={() => setShowReceipt(true)}
            />
          </div>
        )}
        {(open || showReceipt) && (
          <Detail
            id={row.id}
            customer={row.customer_name}
            showItems={open}
            showReceipt={showReceipt}
            onOpenReceipt={() => setShowReceipt(true)}
            onCloseReceipt={() => setShowReceipt(false)}
          />
        )}
      </div>
    );
  }
  function Transactions({ query }) {
    const [offset, setOffset] = useState(0),
      [result, error] = useResource(
        listPath + "?" + query + "&offset=" + offset,
      );
    if (!result) return <Pending error={error} />;
    return (
      <>
        {result.rows.map((row) => (
          <Transaction key={row.id} row={row} />
        ))}
        {!result.rows.length && <p className="rv-note">Tidak ada transaksi.</p>}
        {(offset > 0 || result.hasMore) && (
          <div className="rv-report-pagination">
            <button
              type="button"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >
              Sebelumnya
            </button>
            <span>
              {offset + 1}–{offset + result.rows.length} / {result.total}
            </span>
            <button
              type="button"
              disabled={!result.hasMore}
              onClick={() => setOffset(offset + 30)}
            >
              Berikutnya
            </button>
          </div>
        )}
      </>
    );
  }
  function Trip({ trip, query, day }) {
    const [open, setOpen] = useState(false);
    return (
      <section className="rv-report-trip">
        <header className="rv-report-trip-head">
          <button
            type="button"
            className="rv-report-trip-toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span className="rv-report-trip-label">
              <strong>
                {trip.number ? "Trip " + trip.number : "Transaksi di depot"}
              </strong>
              <small>
                {trip.departure_day && trip.departure_day !== day
                  ? dateLabel(trip.departure_day) + " · "
                  : ""}
                {trip.departed_at ? timeLabel(trip.departed_at) + " · " : ""}
                {trip.count} transaksi
              </small>
            </span>
            <ChevronDown size={18} />
          </button>
          {trip.photo_id && (
            <PhotoButton
              id={trip.photo_id}
              frame="trip"
              className="rv-report-trip-photo"
              label={
                "Foto Trip " + trip.number + " · " + dateLabel(trip.departed_at)
              }
            />
          )}
        </header>
        {open && (
          <Transactions query={encoded(query, { day, trip: trip.id })} />
        )}
      </section>
    );
  }
  function Trips({ query, day }) {
    const [result, error] = useResource(
      prefix + "trips?" + encoded(query, { day }),
    );
    if (!result) return <Pending error={error} />;
    return (
      <div className="rv-report-trip-list">
        {result.rows.map((trip) =>
          trip.number ? (
            <Trip key={trip.id} trip={trip} query={query} day={day} />
          ) : (
            <Transactions
              key={trip.id}
              query={encoded(query, { day, trip: trip.id })}
            />
          ),
        )}
      </div>
    );
  }
  function DayTransactions({ query, day, counter }) {
    return transactionsOnly && counter ? (
      <Transactions query={encoded(query, { day })} />
    ) : (
      <Trips query={query} day={day} />
    );
  }
  function Day({ row, query, counter }) {
    const [open, setOpen] = useState(false);
    return (
      <section className="rv-report-day">
        <button
          type="button"
          className="rv-report-day-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <CalendarDays size={16} />
          <strong>
            {dateLabel(row.day)} {row.day.slice(0, 4)}
          </strong>
          <span>{row.count} transaksi</span>
          <ChevronDown size={16} />
        </button>
        {open && (
          <DayTransactions query={query} day={row.day} counter={counter} />
        )}
      </section>
    );
  }
  function Days({ query, counter }) {
    const [result, error] = useResource(prefix + "days?" + query);
    if (!result) return <Pending error={error} />;
    return (
      <div className="rv-report-days">
        {result.rows.map((row) => (
          <Day key={row.day} row={row} query={query} counter={counter} />
        ))}
      </div>
    );
  }
  function Channel({ row, query, multiDay, day }) {
    const [open, setOpen] = useState(false);
    const next = encoded(query, { channel: row.key });
    const counter = row.key.startsWith("counter");
    return (
      <section className="rv-report-channel">
        <button
          type="button"
          className="rv-report-channel-heading"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {counter ? <Store size={17} /> : <Truck size={17} />}
          <strong>{row.name}</strong>
          <span>{row.count} transaksi</span>
          <ChevronDown size={17} />
        </button>
        {open &&
          (multiDay ? (
            <Days query={next} counter={counter} />
          ) : (
            <DayTransactions query={next} day={day} counter={counter} />
          ))}
      </section>
    );
  }
  return function ReportExplorer({ query, search, multiDay, day }) {
    const request = encoded(query, { search }),
      [result, error] = useResource(prefix + "channels?" + request, {
        keepPrevious: true,
      });
    return (
      <div className="rv-report-explorer">
        <div className="rv-section-heading">
          <h3>Transaksi</h3>
          <span>{result?.count || 0} transaksi</span>
        </div>
        {!result ? (
          <Pending error={error} />
        ) : result.rows.length ? (
          <div className="rv-report-sections">
            {result.rows.map((row) => (
              <Channel
                key={request + row.key}
                row={row}
                query={request}
                multiDay={multiDay}
                day={day}
              />
            ))}
          </div>
        ) : (
          <Empty>Belum ada transaksi pada pilihan ini.</Empty>
        )}
      </div>
    );
  };
}
