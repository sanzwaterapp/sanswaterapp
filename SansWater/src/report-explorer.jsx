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
} from "lucide-react";
import { money, dateLabel, timeLabel } from "./api.js";

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
    ({ method, sales, debt, net, transferIn = 0, transferOut = 0 }) => (
      <div className="rv-receipt-method" data-method={method} key={method}>
        <strong className="rv-receipt-method-label">
          {method === "Tunai" ? <Banknote size={13} /> : <ScanLine size={13} />}{" "}
          {method}
        </strong>
        {(sales > 0 || debt > 0 || transferIn > 0 || transferOut > 0) && (
          <dl className="rv-report-sources">
            {[
              ["Penjualan", sales, false],
              ["Bayar hutang", debt, false],
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
      return (
        <p
          className={error ? "rv-error" : "rv-note"}
          role={error ? "alert" : "status"}
        >
          {error || "Memuat…"}
        </p>
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

export function createReportExplorer(UI) {
  const { useResource, Identity, PhotoButton, Empty } = UI;
  const encoded = (query, values) =>
    query + "&" + new URLSearchParams(values).toString();
  function Pending({ error }) {
    return (
      <p
        className={error ? "rv-error" : "rv-note"}
        role={error ? "alert" : "status"}
      >
        {error || "Memuat…"}
      </p>
    );
  }
  function Detail({ id }) {
    const [row, error] = useResource(
      "/report-transactions/" + encodeURIComponent(id),
    );
    if (!row) return <Pending error={error} />;
    return (
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
                <dd>{money(row.discount)}</dd>
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
      </div>
    );
  }
  function Transaction({ row }) {
    const [open, setOpen] = useState(false);
    return (
      <div className="rv-report-transaction">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="rv-report-transaction-top">
            <Identity code={row.customer_code} name={row.customer_name} />

            {!!(row.shipping || row.discount) && (
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
        </button>
        {open && <Detail id={row.id} />}
      </div>
    );
  }
  function Transactions({ query }) {
    const [offset, setOffset] = useState(0),
      [result, error] = useResource(
        "/report-transactions?" + query + "&offset=" + offset,
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
      "/report-trips?" + encoded(query, { day }),
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
  function Day({ row, query }) {
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
        {open && <Trips query={query} day={row.day} />}
      </section>
    );
  }
  function Days({ query }) {
    const [result, error] = useResource("/report-days?" + query);
    if (!result) return <Pending error={error} />;
    return (
      <div className="rv-report-days">
        {result.rows.map((row) => (
          <Day key={row.day} row={row} query={query} />
        ))}
      </div>
    );
  }
  function Channel({ row, query, multiDay, day }) {
    const [open, setOpen] = useState(false);
    const next = encoded(query, { channel: row.key });
    return (
      <section className="rv-report-channel">
        <button
          type="button"
          className="rv-report-channel-heading"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {row.key === "counter" ? <Store size={17} /> : <Truck size={17} />}
          <strong>{row.name}</strong>
          <span>{row.count} transaksi</span>
          <ChevronDown size={17} />
        </button>
        {open &&
          (multiDay ? <Days query={next} /> : <Trips query={next} day={day} />)}
      </section>
    );
  }
  return function ReportExplorer({ query, search, multiDay, day }) {
    const request = encoded(query, { search }),
      [result, error] = useResource("/report-channels?" + request, {
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
