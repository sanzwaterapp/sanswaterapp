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
  SquarePen,
  Trash2,
} from "lucide-react";
import { api, money, dateLabel, timeLabel } from "./api.js";
import AppForm from "./AppForm.jsx";
import OverlayDialog, { LoadingState } from "./OverlayDialog.jsx";
import PeriodFilters from "./period-filters.jsx";
import { formatLiters } from "./water-volume.js";
import { hasItemShipping, itemShipping } from "./order-pricing.js";
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
    ["ro1Shift1", "RO 1 · Shift 1"],
    ["ro2Shift1", "RO 2 · Shift 1"],
    ["mineralShift1", "Mineral · Shift 1"],
    ["ro1Shift2", "RO 1 · Shift 2"],
    ["ro2Shift2", "RO 2 · Shift 2"],
    ["mineralShift2", "Mineral · Shift 2"],
  ];
  const number = (value) =>
    Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 });
  function Editor({ result }) {
    const { act, busy } = useApp();
    const [draft, setDraft] = useState(result.config);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const drivers = result.rows.filter((row) => row.deliveryOrders > 0);
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
          Object.prototype.hasOwnProperty.call(draft.drivers, driver.id),
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
      if (result.readOnly)
        return (
          <div className="rv-payroll-readonly">
            <strong>
              {result.actors.find((u) => u.id === item.actor)?.name || "—"}
            </strong>
            <span>{money(item.rate)} / galon</span>
          </div>
        );
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
          {[1, 2]
            .filter(
              (shift) =>
                !result.ownOnly ||
                components.some(
                  ([key]) =>
                    key.endsWith(String(shift)) && draft.meters[key].actor,
                ),
            )
            .map((shift) => (
              <section
                className="rv-card rv-payroll-shift-block"
                aria-label={"Shift " + shift}
                key={shift}
              >
                <h4>Shift {shift}</h4>
                <div className="rv-payroll-shift-grid">
                  {components
                    .filter(
                      ([key]) =>
                        key.endsWith(String(shift)) &&
                        (!result.ownOnly || draft.meters[key].actor),
                    )
                    .map(([key, label]) => (
                      <div
                        key={key}
                        className={"rv-payroll-volume rv-payroll-" + key}
                      >
                        <header className="rv-payroll-product-heading">
                          {key.startsWith("ro")
                            ? key.startsWith("ro1")
                              ? "RO 1"
                              : "RO 2"
                            : "Mineral"}
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
          {drivers.length > 0 && (
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
                        readOnly={result.readOnly}
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
              </div>
            </section>
          )}
        </div>
        {error && (
          <p role="alert" className="rv-error">
            {error}
          </p>
        )}
        {!result.readOnly && <Submit>Simpan pengaturan</Submit>}
        {notice && (
          <p className="rv-note" role="status">
            {notice}
          </p>
        )}
        <section
          className="rv-card rv-payroll-salary-summary"
          aria-label="Jumlah pendapatan karyawan"
        >
          <div className="rv-section-heading">
            <h3>Jumlah pendapatan</h3>
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
                  {!result.readOnly && (
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
                  )}
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
    const full = data.user.owner || data.user.permissions.includes("reports");
    const [period, setPeriod, query] = usePeriod(full ? "month" : "today");
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

export function createFinancialActions({ useApp, useResource }) {
  function Editor({ id, kind, startDeleting, onClose }) {
    const { act } = useApp(),
      [row, error] = useResource(
        kind === "invoice" ? "/invoices/" + id + "/edit" : "/payments/" + id,
        { live: false },
      );
    return (
      <OverlayDialog
        onClose={onClose}
        className={
          "rv-finance-editor" +
          (startDeleting ? " rv-finance-delete-dialog" : "")
        }
        aria-label={
          startDeleting ? "Hapus transaksi" : "Koreksi transaksi Owner"
        }
      >
        <div className="rv-section-heading">
          <h3>
            {startDeleting && <Trash2 size={17} aria-hidden="true" />}
            {startDeleting ? "Hapus" : "Koreksi"}{" "}
            {kind === "invoice" ? "transaksi" : "pembayaran"}
          </h3>
          <button type="button" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        {!row ? (
          <p role="status">{error || "Memuat…"}</p>
        ) : (
          <Form
            key={row.revision || row.version}
            row={row}
            kind={kind}
            startDeleting={startDeleting}
            act={act}
            onClose={onClose}
          />
        )}
      </OverlayDialog>
    );
  }
  function Form({ row, kind, startDeleting, act, onClose }) {
    const invoice = kind === "invoice",
      [draft, setDraft] = useState({
        ...row,
        paid: row.paid ?? row.amount,
        method: row.method || row.payments?.[0]?.method || "Tunai",
      }),
      [reason, setReason] = useState(""),
      [error, setError] = useState(""),
      [deleting, setDeleting] = useState(startDeleting),
      [saving, setSaving] = useState(false);
    async function save(remove = false) {
      if (saving) return;
      setSaving(true);
      setError("");
      try {
        await act(() =>
          api((invoice ? "/invoices/" : "/payments/") + row.id, {
            method: remove ? "DELETE" : "PATCH",
            body: {
              ...draft,
              amount: Number(draft.paid),
              paid: Number(draft.paid),
              shipping: Number(draft.shipping),
              discount: Number(draft.discount),
              items: draft.items?.map((l) => ({
                ...l,
                qty: Number(l.qty),
                price: Number(l.price),
                ...(l.shippingRate !== undefined
                  ? { shippingRate: Number(l.shippingRate) }
                  : {}),
              })),
              reason,
              confirmed: remove,
            },
          }),
        );
        onClose();
      } catch (e) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    }
    const unitShipping = invoice && hasItemShipping(draft.items);
    const shippingTotal = unitShipping
      ? itemShipping(draft.items)
      : Number(draft.shipping || 0);
    const correctionTotal = invoice
      ? draft.items.reduce(
          (sum, l) => sum + Number(l.qty) * Number(l.price),
          0,
        ) -
        Number(draft.discount || 0) +
        shippingTotal
      : 0;
    const field = (key, label) => (
      <label className="rv-field">
        <span>{label}</span>
        <input
          type="number"
          min="0"
          step="1"
          required
          value={
            key === "shipping" && unitShipping ? shippingTotal : draft[key]
          }
          readOnly={key === "shipping" && unitShipping}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      </label>
    );
    return (
      <AppForm
        className="rv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save(deleting);
        }}
      >
        <strong>{row.customer_name || "Pembayaran pelanggan"}</strong>
        {!deleting && (
          <>
            {invoice && (
              <>
                {draft.items.map((line, index) => (
                  <div className="rv-finance-edit-line" key={index}>
                    <strong>
                      {line.name} · {line.mode}
                    </strong>
                    <label className="rv-field">
                      <span>Jumlah</span>
                      <input
                        required
                        type="number"
                        min="0"
                        step="1"
                        value={line.qty}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            items: draft.items.map((l, i) =>
                              i === index ? { ...l, qty: e.target.value } : l,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="rv-field">
                      <span>Harga/unit</span>
                      <input
                        required
                        type="number"
                        min="0"
                        step="1"
                        value={line.price}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            items: draft.items.map((l, i) =>
                              i === index ? { ...l, price: e.target.value } : l,
                            ),
                          })
                        }
                      />
                    </label>
                    {row.trip_id && line.shippingRate !== undefined && (
                      <label className="rv-field">
                        <span>Ongkir/unit</span>
                        <input
                          required
                          type="number"
                          min="0"
                          step="1"
                          value={line.shippingRate}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              items: draft.items.map((l, i) =>
                                i === index
                                  ? { ...l, shippingRate: e.target.value }
                                  : l,
                              ),
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
                <div className="rv-two">
                  {field("discount", "Diskon (Rp)")}
                  {field("shipping", "Ongkir total (Rp)")}
                </div>
                <div className="rv-payment-balance">
                  <span>Total koreksi</span>
                  <strong>{money(correctionTotal)}</strong>
                </div>
              </>
            )}
            <div className="rv-two">
              {field("paid", "Dibayar (Rp)")}
              <label className="rv-field">
                <span>Metode</span>
                <select
                  value={draft.method}
                  onChange={(e) =>
                    setDraft({ ...draft, method: e.target.value })
                  }
                >
                  <option>Tunai</option>
                  <option>QRIS</option>
                </select>
              </label>
            </div>
          </>
        )}
        {deleting && (
          <p className="rv-finance-delete-note">
            {invoice
              ? "Stok dikembalikan. Tagihan dan pembayaran transaksi ini dibatalkan."
              : "Pembayaran dibatalkan dan saldo utang diperbarui."}
          </p>
        )}
        <label className="rv-field">
          <span>Alasan {deleting ? "penghapusan" : "koreksi"}</span>
          <input
            required
            maxLength="500"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p className="rv-error" role="alert">
            {error}
          </p>
        )}
        {startDeleting ? (
          <div className="rv-finance-delete-buttons">
            <button
              type="button"
              className="rv-secondary"
              disabled={saving}
              onClick={onClose}
            >
              Batal
            </button>
            <button
              type="submit"
              className="rv-primary rv-finance-delete-confirm"
              disabled={saving}
            >
              {saving ? "Menghapus…" : "Hapus transaksi"}
            </button>
          </div>
        ) : (
          <>
            <button
              className={deleting ? "rv-danger" : "rv-primary"}
              disabled={saving}
              type="submit"
            >
              {saving
                ? "Menyimpan…"
                : deleting
                  ? "Ya, batalkan"
                  : "Simpan koreksi"}
            </button>
            <button
              type="button"
              className="rv-text-button"
              disabled={saving}
              onClick={() => setDeleting(!deleting)}
            >
              {deleting
                ? "Kembali ke koreksi"
                : "Hapus " +
                  (invoice ? "transaksi dan pembayaran" : "pembayaran")}
            </button>
          </>
        )}
      </AppForm>
    );
  }
  return function FinancialActions({
    id,
    kind = "invoice",
    compact = false,
    showDelete = false,
    deleteOnly = false,
  }) {
    const { data } = useApp(),
      [action, setAction] = useState(null);
    if (!data.user.owner) return null;
    return (
      <>
        {!deleteOnly && (
          <button
            type="button"
            className={
              "rv-secondary rv-owner-correct" + (compact ? " is-compact" : "")
            }
            onClick={() => setAction("correct")}
          >
            <SquarePen size={13} /> Koreksi
          </button>
        )}
        {(showDelete || deleteOnly) && (
          <button
            type="button"
            className="rv-secondary rv-owner-delete"
            onClick={() => setAction("delete")}
          >
            <Trash2 size={13} /> Hapus transaksi
          </button>
        )}
        {action && (
          <Editor
            id={id}
            kind={kind}
            startDeleting={action === "delete"}
            onClose={() => setAction(null)}
          />
        )}
      </>
    );
  };
}

export function createReportExplorer(UI, { transactionsOnly = false } = {}) {
  const { useApp, useResource, Identity, PhotoButton, Empty } = UI;
  const FinancialActions = createFinancialActions(UI);
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
            <div className="rv-owner-actions">
              <FinancialActions id={id} showDelete={transactionsOnly} />
            </div>
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
            {transactionsOnly ? (
              <strong>{money(row.total)}</strong>
            ) : (
              <span className="rv-report-status-amount">
                {methods && (
                  <span className="rv-report-payment-chip">{methods}</span>
                )}
                <strong>{money(row.total)}</strong>
              </span>
            )}
            <ChevronDown size={15} />
          </span>
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
        {!transactionsOnly && (
          <div className="rv-report-transaction-meta-row">
            {orderTime}
            <div className="rv-owner-actions rv-report-delete-actions">
              <FinancialActions id={row.id} deleteOnly />
            </div>
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
