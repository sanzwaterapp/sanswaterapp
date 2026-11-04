import React, { useEffect, useState } from "react";
import { Banknote, ScanLine, ChevronDown, Wallet, Plus, X } from "lucide-react";
import AppForm from "./AppForm.jsx";
import { api, money, dateLabel, timeLabel, can } from "./api.js";
import { CASH_METHODS } from "./cash-funds.js";

export function FundSummary({ funds, periodLabel = "" }) {
  if (!funds) return null;
  const totalNet = funds.rows.reduce((sum, row) => sum + row.net, 0);
  const tiles = (values) => (
    <dl className="rv-finance-tiles">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{money(value)}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section className="rv-card rv-fund-summary" aria-label="Arus kas">
      <div className="rv-section-heading">
        <h3>
          <Wallet size={17} /> Arus kas{periodLabel ? " " + periodLabel : ""}
        </h3>
        <strong
          className="rv-fund-summary-total"
          aria-label={"Total arus bersih " + money(totalNet)}
        >
          {money(totalNet)}
        </strong>
      </div>
      {funds.rows.map((row) => (
        <details
          className={"rv-fund-card rv-finance-account rv-fund-" + row.key}
          key={row.key}
        >
          <summary>
            <strong>
              <Wallet size={14} />
              {row.name}
            </strong>
            <span
              className="rv-fund-header-net"
              aria-label={"Arus bersih " + money(row.net)}
            >
              <b>{money(row.net)}</b>
            </span>
            <ChevronDown size={16} />
          </summary>
          <div className="rv-finance-account-body">
            {CASH_METHODS.map((method) => (
              <div className="rv-receipt-method" key={method}>
                <strong className="rv-receipt-method-label">
                  {method === "Tunai" ? (
                    <Banknote size={13} />
                  ) : (
                    <ScanLine size={13} />
                  )}
                  {method}
                </strong>
                {tiles([
                  ["Masuk", row.methods[method].incoming],
                  ["Keluar", row.methods[method].outgoing],
                  ["Arus bersih", row.methods[method].closing],
                ])}
              </div>
            ))}
            {(row.transferIn > 0 || row.transferOut > 0) && (
              <p className="rv-fund-transfer-line">
                Perpindahan lama: masuk {money(row.transferIn)} · keluar{" "}
                {money(row.transferOut)}
              </p>
            )}
          </div>
        </details>
      ))}
      {!!funds.unassignedProducts.length && (
        <p className="rv-cash-unmapped" role="status">
          Perlu pemetaan kategori:{" "}
          {funds.unassignedProducts.map((p) => (
            <a key={p.id} href="#products">
              {p.name}
            </a>
          ))}
        </p>
      )}
    </section>
  );
}

export function createCashPage(UI) {
  const {
    useApp,
    Header,
    Field,
    Currency,
    Submit,
    PhotoButton,
    Empty,
    useResource,
    usePeriod,
    Period,
  } = UI;
  return function Expenses() {
    const { data, act } = useApp(),
      [period, setPeriod, query] = usePeriod(),
      [revision, setRevision] = useState(0),
      [filter, setFilter] = useState("all"),
      [offset, setOffset] = useState(0),
      [ledger, error] = useResource(
        "/cash-ledger?" +
          query +
          "&kind=expense&fund=" +
          filter +
          "&offset=" +
          offset +
          "&revision=" +
          revision,
      ),
      [form, setForm] = useState(null),
      [voiding, setVoiding] = useState(null),
      [message, setMessage] = useState("");
    const fundName = (key) =>
      data.cashFunds?.find((f) => f.key === key)?.name || key;
    useEffect(() => {
      if (!message) return;
      const timer = setTimeout(() => setMessage(""), 4000);
      return () => clearTimeout(timer);
    }, [message]);
    const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));
    const changed = () => {
      setRevision((n) => n + 1);
      setOffset(0);
    };
    return (
      <>
        <Header
          title="Pengeluaran"
          icon={Wallet}
          back={can(data.user, "reports") ? "reports" : "other"}
        >
          {can(data.user, "expenses") && (
            <button
              className="rv-header-button"
              onClick={() =>
                setForm({
                  kind: "expense",
                  day: data.today,
                  fromFund: data.cashFunds?.[0]?.key || "",
                  fromMethod: "Tunai",
                  amount: "",
                  category: "",
                })
              }
            >
              <Plus size={15} /> Pengeluaran
            </button>
          )}
        </Header>
        <main className="rv-body rv-feature rv-expenses-body">
          {form && (
            <AppForm
              className="rv-card rv-stack rv-cash-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await act(async () => {
                  await api("/cash-entries", {
                    method: "POST",
                    body: { ...form, amount: Number(form.amount) },
                  });
                  setMessage(
                    "Pengeluaran " + money(form.amount) + " tersimpan.",
                  );
                  setForm(null);
                  changed();
                }).catch(() => {});
              }}
            >
              <div className="rv-section-heading">
                <h3>Pengeluaran baru</h3>
                <button
                  type="button"
                  className="rv-icon-button"
                  aria-label="Tutup form pengeluaran"
                  onClick={() => setForm(null)}
                >
                  <X size={17} />
                </button>
              </div>
              <Field
                label="Pengeluaran"
                placeholder="Mis. listrik, gaji, pembelian Gas"
                required
                maxLength={60}
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
              />
              <div className="rv-two">
                <Currency
                  label="Nominal (Rp)"
                  required
                  min="1"
                  value={form.amount}
                  onChange={(v) => update("amount", v)}
                />
                <Field label="Kas">
                  <select
                    required
                    value={form.fromFund}
                    onChange={(e) => update("fromFund", e.target.value)}
                  >
                    {(data.cashFunds || []).map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="rv-two">
                <Field
                  label="Tanggal"
                  type="date"
                  required
                  max={data.today}
                  value={form.day}
                  onChange={(e) => update("day", e.target.value)}
                />
                <Field label="Metode">
                  <select
                    required
                    value={form.fromMethod}
                    onChange={(e) => update("fromMethod", e.target.value)}
                  >
                    {CASH_METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Submit>Simpan pengeluaran</Submit>
            </AppForm>
          )}
          <Period
            value={period}
            onChange={(v) => {
              setPeriod(v);
              setOffset(0);
            }}
            label="Periode pengeluaran"
            allLabel="Semua waktu"
          />
          {error && (
            <p className="rv-error" role="alert">
              {error}
            </p>
          )}
          <div className="rv-section-heading rv-expense-history-heading">
            <h3>Riwayat pengeluaran</h3>
            <select
              aria-label="Filter kas"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="all">Semua kas</option>
              {(data.cashFunds || []).map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="rv-cash-entry-list">
            {ledger?.rows.map((row) => (
              <article
                className={
                  "rv-card rv-cash-entry" +
                  (row.voided_at ? " rv-cash-entry-void" : "")
                }
                key={row.id}
              >
                <div className="rv-stock-log-top">
                  <strong>
                    {row.kind === "expense"
                      ? row.category
                      : "Perpindahan kas lama"}
                  </strong>
                  <b>{money(row.amount)}</b>
                </div>
                <p>
                  {fundName(row.from_fund)} · {row.from_method}
                  {row.to_fund && (
                    <>
                      {" "}
                      → {fundName(row.to_fund)} · {row.to_method}
                    </>
                  )}
                </p>
                <div className="rv-stock-log-meta">
                  <time>{dateLabel(row.day)}</time>
                  <span>
                    Dicatat oleh <strong>{row.actor}</strong>
                  </span>
                </div>
                <small className="rv-cash-entry-recorded">
                  {dateLabel(row.created_at)} · {timeLabel(row.created_at)} WIB
                </small>
                {row.note && <p>{row.note}</p>}
                <div className="rv-cash-entry-actions">
                  {row.proof_id && (
                    <PhotoButton id={row.proof_id} label="Bukti pengeluaran" />
                  )}
                  {row.voided_at ? (
                    <small>
                      Dibatalkan · {row.void_reason} · {row.void_actor}
                    </small>
                  ) : (
                    can(data.user, "expenses") &&
                    can(data.user, "correct") &&
                    (data.user.owner || row.actor_id === data.user.id) && (
                      <button
                        type="button"
                        className="rv-text-button"
                        onClick={() => setVoiding({ ...row, reason: "" })}
                      >
                        Batalkan
                      </button>
                    )
                  )}
                </div>
                {voiding?.id === row.id && (
                  <AppForm
                    className="rv-stack rv-cash-void-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await act(async () => {
                        await api("/cash-entries/" + row.id + "/void", {
                          method: "POST",
                          body: {
                            version: row.version,
                            reason: voiding.reason,
                          },
                        });
                        setVoiding(null);
                        changed();
                        setMessage("Catatan dibatalkan.");
                      }).catch(() => {});
                    }}
                  >
                    <Field
                      label="Alasan pembatalan"
                      required
                      value={voiding.reason}
                      maxLength={500}
                      onChange={(e) =>
                        setVoiding({ ...voiding, reason: e.target.value })
                      }
                    />
                    <div className="rv-two">
                      <button
                        type="button"
                        className="rv-secondary"
                        onClick={() => setVoiding(null)}
                      >
                        Kembali
                      </button>
                      <Submit>Batalkan catatan</Submit>
                    </div>
                  </AppForm>
                )}
              </article>
            ))}
          </div>
          {ledger && !ledger.rows.length && (
            <Empty icon={Wallet}>Belum ada pengeluaran.</Empty>
          )}
          {(offset > 0 || ledger?.hasMore) && (
            <div className="rv-stock-log-pagination">
              <button
                className="rv-secondary"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                Sebelumnya
              </button>
              <span>{Math.floor(offset / 30) + 1}</span>
              <button
                className="rv-secondary"
                disabled={!ledger?.hasMore}
                onClick={() => setOffset(offset + 30)}
              >
                Berikutnya
              </button>
            </div>
          )}
          {message && (
            <div
              className="rv-validation-message rv-payment-success"
              role="status"
            >
              <span>{message}</span>
            </div>
          )}
        </main>
      </>
    );
  };
}
