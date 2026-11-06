import React, { useEffect, useState } from "react";
import {
  Banknote,
  ScanLine,
  ChevronDown,
  Wallet,
  Plus,
  X,
  UserRound,
  CalendarDays,
} from "lucide-react";
import AppForm from "./AppForm.jsx";
import { api, money, dateLabel, timeLabel, can } from "./api.js";
import { CASH_METHODS } from "./cash-funds.js";
import PeriodFilters from "./period-filters.jsx";
import { CashMethodDetails } from "./report-explorer.jsx";
import { staffColor } from "./stock-history-display.js";
import { periodDates } from "./period-range.js";

export function FundSummary({ funds, periodLabel = "", query, CashFlowList }) {
  const [opened, setOpened] = useState({});
  if (!funds) return null;
  const totalNet = funds.rows.reduce((sum, row) => sum + row.net, 0);
  return (
    <section className="rv-card rv-fund-summary" aria-label="Laporan per kas">
      <div className="rv-section-heading">
        <h3>
          <Wallet size={17} /> Laporan per kas
          {periodLabel ? " " + periodLabel : ""}
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
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setOpened((previous) => ({ ...previous, [row.key]: open }));
          }}
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
          {opened[row.key] && (
            <div className="rv-finance-account-body">
              <CashFlowList key={query + row.key} query={query} fund={row.key}>
                {(expenses) => (
                  <CashMethodDetails
                    expenses={expenses}
                    methods={CASH_METHODS.map((method) => ({
                      method,
                      sales: row.sources?.[method]?.sales || 0,
                      debt: row.sources?.[method]?.debt || 0,
                      net: row.methods[method].closing,
                      transferIn: row.methods[method].transferIn,
                      transferOut: row.methods[method].transferOut,
                    }))}
                  />
                )}
              </CashFlowList>
            </div>
          )}
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
    const dates = periodDates(data.today, period);
    const multiDay = dates.from !== dates.to;
    const dayGroups = new Map();
    for (const row of ledger?.rows || []) {
      if (!dayGroups.has(row.day)) dayGroups.set(row.day, []);
      dayGroups.get(row.day).push(row);
    }
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
    const renderEntry = (row) => (
      <article
        className={
          "rv-card rv-cash-entry" + (row.voided_at ? " rv-cash-entry-void" : "")
        }
        key={row.id}
        style={staffColor(row.actor_id)}
      >
        <div className="rv-cash-entry-top">
          <strong title={row.category + (row.note ? " · " + row.note : "")}>
            {row.kind === "expense"
              ? row.note?.trim() || row.category
              : "Perpindahan kas lama"}
          </strong>
          <b>{money(row.amount)}</b>
        </div>
        <div className="rv-cash-entry-meta">
          <span
            className="rv-cash-entry-fund-chip"
            title={fundName(row.from_fund)}
          >
            {fundName(row.from_fund)}
          </span>
          <span className="rv-cash-entry-method">
            {row.from_method === "Tunai" ? (
              <Banknote size={12} />
            ) : (
              <ScanLine size={12} />
            )}
            {row.from_method}
          </span>
          {row.to_fund && (
            <>
              {" "}
              → {fundName(row.to_fund)} · {row.to_method}
            </>
          )}
          <span
            className="rv-payment-record-actor"
            title={
              "Dicatat oleh " +
              row.actor +
              " · " +
              dateLabel(row.created_at) +
              " · " +
              timeLabel(row.created_at) +
              " WIB"
            }
            aria-label={
              "Dicatat oleh " +
              row.actor +
              " pada " +
              dateLabel(row.created_at) +
              " pukul " +
              timeLabel(row.created_at) +
              " WIB"
            }
          >
            <UserRound size={12} />
            <span>{row.actor}</span>
          </span>
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
              (data.user.owner || row.actor_id === data.user.id) &&
              voiding?.id !== row.id && (
                <button
                  type="button"
                  className="rv-text-button rv-cash-entry-cancel"
                  onClick={() => setVoiding({ ...row, reason: "" })}
                >
                  Batalkan
                </button>
              )
            )}
          </div>
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
            <input
              aria-label="Alasan pembatalan"
              placeholder="Alasan pembatalan"
              autoFocus
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
                aria-label="Kembali"
                onClick={() => setVoiding(null)}
              >
                <X size={14} />
              </button>
              <Submit>Batalkan</Submit>
            </div>
          </AppForm>
        )}
      </article>
    );
    return (
      <>
        <Header
          title="Pengeluaran"
          icon={Wallet}
          back={can(data.user, "reports") ? "reports" : "other"}
          className="rv-reports-header"
          filters={
            <PeriodFilters
              value={period}
              onChange={(value) => {
                setPeriod(value);
                setOffset(0);
              }}
              today={data.today}
              label="Periode pengeluaran"
            />
          }
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
            {multiDay
              ? [...dayGroups].map(([day, rows]) => (
                  <details
                    className="rv-cash-day"
                    key={query + filter + day}
                    aria-label={
                      "Pengeluaran " + dateLabel(day) + " " + day.slice(0, 4)
                    }
                  >
                    <summary className="rv-cash-day-heading">
                      <CalendarDays size={14} />
                      <time dateTime={day}>
                        {dateLabel(day)} {day.slice(0, 4)}
                      </time>
                      <span>{rows.length} catatan</span>
                      <ChevronDown size={15} />
                    </summary>
                    <div className="rv-cash-day-entries">
                      {rows.map(renderEntry)}
                    </div>
                  </details>
                ))
              : ledger?.rows.map(renderEntry)}
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
