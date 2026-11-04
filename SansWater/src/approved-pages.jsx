import AppForm from "./AppForm.jsx";
import DepartureCamera from "./DepartureCamera.jsx";
import DebtStatement from "./debt-statement.jsx";
import React, { useEffect, useRef, useState } from "react";
import { groupTripsByNumber } from "./trip-groups.js";
import DateRangePicker from "./date-range-picker.jsx";
import PeriodFilters from "./period-filters.jsx";
import { periodDates } from "./period-range.js";
import { menuItemsFor } from "./app-menu-items.js";
import { canAccessPage } from "./page-access.js";
import { createCashPage, FundSummary } from "./cash-pages.jsx";
import { createReportExplorer } from "./report-explorer.jsx";
import DurationChip from "./DurationChip.jsx";
import { productChoiceLabel } from "./product-labels.js";
import { readableColor } from "./duration-settings.js";
import { staffColor } from "./stock-history-display.js";
import {
  deliveryCategories,
  deliveryCategory,
} from "./delivery-performance.js";
import {
  Droplets,
  Truck,
  Percent,
  Banknote,
  ScanLine,
  Wallet,
  ClipboardList,
  Check,
  ChevronRight,
  ChevronDown,
  Plus,
  UserRound,
  Camera,
  X,
  Grid2X2,
  Users,
  Package,
  ChartNoAxesCombined,
  Monitor,
  Settings,
  ShieldCheck,
  LogOut,
  Search,
  Minus,
  BadgeCheck,
  ArrowUpRight,
  Store,
  ContactRound,
  UsersRound,
  TvMinimal,
  Settings2,
  BadgePercent,
  CircleX,
  ShoppingBag,
  CalendarDays,
  Timer,
  SquarePen,
  History,
  ReceiptText,
} from "lucide-react";
import {
  api,
  money,
  dateLabel,
  timeLabel,
  can,
  statuses,
  filters,
  filterLabels,
  duration,
  imageFile,
} from "./api.js";

// Komponen memakai struktur/class CSS pratinjau terakhir. Data dan aksi tetap API nyata.
export function createApprovedPages(UI) {
  const {
    useApp,
    Header,
    Field,
    Currency,
    Submit,
    PhotoButton,
    CameraCapture,
    Identity,
    Empty,
    CustomerPicker,
    useResource,
    usePeriod,
    Period,
    SearchField,
  } = UI;
  const go = (page) => {
    window.location.hash = page;
  };
  const orderProductSummary = (order) => {
    return order.items.map((line) => line.qty + " " + line.name).join(" + ");
  };
  function OrderQuantityNote({ revision }) {
    if (!revision) return null;
    const editor = revision.editedBy;
    return (
      <div className="rv-order-revision">
        <span>
          Pesanan awal <b>{revision.initialQty}</b> · Diubah menjadi{" "}
          <b>{revision.finalQty}</b>
        </span>
        <span
          className="rv-order-revision-actor"
          title={editor.name || editor.username}
        >
          <UserRound size={12} />
          <span>{editor.username || editor.name}</span>
        </span>
      </div>
    );
  }
  function AttendanceList() {
    const { data } = useApp();
    return (
      <div className="rv-card rv-attendance">
        <div className="rv-section-heading">
          <h3>
            <Camera size={14} /> Absensi hari ini
          </h3>
          <span className="rv-attendance-count">
            {data.attendance.length} masuk
          </span>
        </div>
        <div className="rv-attendance-list">
          {data.attendance.map((a) => (
            <div className="rv-attendance-row" key={a.id}>
              <span className="rv-attendance-name">
                <span className="rv-staff-dot">{a.name[0]}</span>
                <strong>{a.name}</strong>
              </span>
              <time>{timeLabel(a.created_at)}</time>
              <PhotoButton id={a.photo_id} label={"Foto absensi " + a.name} />
            </div>
          ))}
          {!data.attendance.length && (
            <span className="rv-note">Belum ada absensi hari ini.</span>
          )}
        </div>
      </div>
    );
  }
  function DeliveryPerformance({ orders, periodLabel, periodKey, error }) {
    const { data } = useApp(),
      DELIVERY_CATEGORIES = deliveryCategories(data.settings),
      [category, setCategory] = useState(null),
      [visibleCount, setVisibleCount] = useState(5),
      groups = Object.fromEntries(
        DELIVERY_CATEGORIES.map(({ key }) => [key, []]),
      );
    for (const order of orders || []) {
      const key = deliveryCategory(order.seconds, data.settings);
      if (key) groups[key].push(order);
    }
    const selected =
        (category && groups[category] ? category : null) ||
        DELIVERY_CATEGORIES.find(({ key }) => groups[key].length)?.key ||
        DELIVERY_CATEGORIES[0].key,
      band = DELIVERY_CATEGORIES.find(({ key }) => key === selected),
      shown = groups[selected];
    useEffect(() => {
      setCategory(null);
      setVisibleCount(5);
    }, [
      periodKey,
      data.settings.deliveryDuration,
      data.settings.durationCategories,
    ]);
    return (
      <section
        className="rv-card rv-home-delivery-time"
        aria-labelledby="rv-delivery-time-title"
      >
        <div className="rv-section-heading">
          <h3 id="rv-delivery-time-title">
            <Timer size={15} /> Waktu pengantaran
          </h3>
          <span className="rv-delivery-count">
            {orders ? orders.length : "—"} selesai
          </span>
        </div>
        <div
          className="rv-delivery-tabs"
          role="group"
          aria-label="Kategori waktu pengantaran"
          style={{
            gridTemplateColumns: `repeat(${DELIVERY_CATEGORIES.length > 3 ? 2 : DELIVERY_CATEGORIES.length}, minmax(0, 1fr))`,
          }}
        >
          {DELIVERY_CATEGORIES.map(({ key, label, range, color }) => (
            <button
              type="button"
              key={key}
              className={
                "rv-delivery-category rv-delivery-" +
                key +
                (color ? " rv-delivery-custom" : "")
              }
              style={
                color
                  ? {
                      "--delivery-tint": color + "22",
                      "--delivery-ink": "#584669",
                      "--delivery-solid": color,
                      "--delivery-on-solid": readableColor(color),
                    }
                  : undefined
              }
              aria-pressed={selected === key}
              aria-label={
                label +
                ": " +
                (orders ? groups[key].length : "—") +
                " pesanan, " +
                range
              }
              onClick={() => {
                setCategory(key);
                setVisibleCount(5);
              }}
            >
              {label} <b>{orders ? groups[key].length : "—"}</b>
            </button>
          ))}
        </div>
        {shown.length ? (
          <>
            <div className="rv-delivery-orders">
              {shown.slice(0, visibleCount).map((order) => (
                <article className="rv-delivery-order" key={order.id}>
                  <div className="rv-delivery-order-main">
                    <span className="rv-delivery-person">
                      <Identity code={order.code} name={order.name} />
                      <small>
                        <UserRound size={13} />
                        {order.courier} · {dateLabel(order.received_at)}
                      </small>
                    </span>
                    <span className="rv-delivery-duration">
                      <DurationChip
                        minutes={Math.floor(order.seconds / 60)}
                        settings={data.settings}
                      />
                      <span className="rv-delivery-clock-range">
                        <time dateTime={order.received_at}>
                          {timeLabel(order.received_at)}
                        </time>
                        <span aria-hidden="true">→</span>
                        <time dateTime={order.completed_at}>
                          {timeLabel(order.completed_at)}
                        </time>
                      </span>
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {shown.length > visibleCount && (
              <button
                type="button"
                className="rv-delivery-more"
                onClick={() => setVisibleCount((value) => value + 5)}
              >
                Lihat {Math.min(5, shown.length - visibleCount)} berikutnya{" "}
                <ChevronDown size={12} />
              </button>
            )}
          </>
        ) : (
          <p className="rv-delivery-empty">
            {orders
              ? orders.length
                ? "Tidak ada pesanan " +
                  band.label.toLowerCase() +
                  " " +
                  periodLabel +
                  "."
                : "Belum ada pengantaran selesai " + periodLabel + "."
              : error
                ? "Daftar pengantaran belum dapat dimuat."
                : "Memuat daftar pengantaran…"}
          </p>
        )}
      </section>
    );
  }
  function Home() {
    const { data } = useApp(),
      [period, setPeriod, query] = usePeriod(),
      [calendarOpen, setCalendarOpen] = useState(false),
      [report, error] = useResource(
        can(data.user, "reports")
          ? "/reports?" +
              query +
              "&view=dashboard&revision=" +
              encodeURIComponent(data.syncVersion || data.now)
          : "/session",
        { keepPrevious: true, resetKey: data.user.id + ":" + query },
      ),
      stats = report?.stats,
      counts = can(data.user, "reports")
        ? report?.orderCounts
        : data.dailyCounts,
      periodLabel = {
        today: "hari ini",
        yesterday: "kemarin",
        week: "minggu ini",
        month: "bulan ini",
        range: "periode ini",
      }[period.kind];
    return (
      <div id="rv-home">
        <section className="rv-home-hero" aria-label="Ringkasan Beranda">
          {can(data.user, "reports") && (
            <div className="rv-card rv-home-sales">
              <div
                className="rv-home-periods"
                role="group"
                aria-label="Periode dashboard"
              >
                {[
                  ["today", "Hari ini"],
                  ["yesterday", "Kemarin"],
                  ["week", "Minggu ini"],
                  ["month", "Bulan ini"],
                  ["range", "Custom"],
                ].map(([kind, label]) => (
                  <button
                    type="button"
                    key={kind}
                    aria-pressed={period.kind === kind}
                    aria-haspopup={kind === "range" ? "dialog" : undefined}
                    aria-expanded={kind === "range" ? calendarOpen : undefined}
                    onClick={() =>
                      kind === "range"
                        ? setCalendarOpen(true)
                        : setPeriod({ ...period, kind })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {period.kind === "range" && (
                <button
                  type="button"
                  className="rv-home-range-label"
                  onClick={() => setCalendarOpen(true)}
                  aria-label="Ubah rentang tanggal"
                >
                  <CalendarDays size={13} />
                  {dateLabel(period.from)} – {dateLabel(period.to)}
                </button>
              )}
              <div className="rv-home-sales-row">
                <span className="rv-home-income-total">
                  <small>Uang masuk</small>
                  <strong className="rv-home-big" aria-label="Total uang masuk">
                    {report?.receipts ? money(report.receipts.total) : "—"}
                  </strong>
                </span>
                <div className="rv-home-breakdown">
                  <span>
                    <span className="rv-home-breakdown-label">
                      <Truck />
                      Ongkir
                    </span>
                    <strong>{money(stats?.shipping)}</strong>
                  </span>
                  <span>
                    <span className="rv-home-breakdown-label">
                      <BadgePercent />
                      Diskon
                    </span>
                    <strong>{money(stats?.discount)}</strong>
                  </span>
                </div>
              </div>
              <dl
                className="rv-home-funds"
                aria-label="Uang masuk per kategori kas"
              >
                {(report?.funds?.rows || data.cashFunds || []).map((fund) => (
                  <div key={fund.key}>
                    <dt>{fund.name}</dt>
                    <dd>{report?.funds ? money(fund.incoming) : "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
        {calendarOpen && (
          <DateRangePicker
            today={data.today}
            value={periodDates(data.today, period)}
            onClose={() => setCalendarOpen(false)}
            onApply={(range) => {
              setPeriod({ ...period, ...range, kind: "range" });
              setCalendarOpen(false);
            }}
          />
        )}
        <main className="rv-body rv-home-body">
          {can(data.user, "reports") && (
            <>
              <div className="rv-home-money">
                {[
                  ["Tunai", "cash", Banknote, "rv-home-cash"],
                  ["QRIS", "qris", ScanLine, "rv-home-qris"],
                  ["Utang", "debt", Wallet, "rv-home-credit"],
                ].map(([label, key, Icon, cls]) => (
                  <button
                    type="button"
                    key={key}
                    className={"rv-card rv-home-money-tile " + cls}
                    onClick={() => go(key === "debt" ? "debt" : "reports")}
                  >
                    <span>
                      <Icon />
                      {label}
                    </span>
                    <strong>{stats ? money(stats[key]) : "—"}</strong>
                  </button>
                ))}
              </div>
              <div className="rv-error">{error}</div>
              <ProductSales rows={report?.productTotals} />
            </>
          )}
          <div className="rv-card rv-home-order-summary">
            <div className="rv-section-heading">
              <h3>
                <ClipboardList size={14} /> Pesanan {periodLabel}
              </h3>
              <span className="rv-attendance-count">
                {counts
                  ? Object.values(counts).reduce((a, b) => a + b, 0)
                  : "—"}{" "}
                pesanan
              </span>
            </div>
            <div className="rv-daily-status-list">
              {Object.entries(filters).map(([key, values]) => {
                const Icon = {
                  orders: ClipboardList,
                  fill: Droplets,
                  delivery: Truck,
                  done: Check,
                  failed: CircleX,
                }[key];
                return (
                  <button
                    className="rv-daily-status-row"
                    key={key}
                    disabled={!canAccessPage(data.user, "orders")}
                    onClick={() => go("orders?" + key + "&" + query)}
                  >
                    <span
                      className={
                        "rv-staff-dot " +
                        (["fill", "done"].includes(key)
                          ? "rv-daily-mint"
                          : key === "failed"
                            ? "rv-daily-rose"
                            : "")
                      }
                    >
                      <Icon />
                    </span>
                    <strong>
                      {key === "failed" ? "Gagal / batal" : filterLabels[key]}
                    </strong>
                    <span className="rv-daily-count">
                      {counts
                        ? values.reduce((n, s) => n + (counts[s] || 0), 0)
                        : "—"}
                    </span>
                    <ChevronRight />
                  </button>
                );
              })}
            </div>
          </div>
          {data.user.owner && (
            <DeliveryPerformance
              orders={report?.deliveryPerformance}
              periodLabel={periodLabel}
              periodKey={period.kind + ":" + query}
              error={error}
            />
          )}
          <AttendanceList />
          {can(data.user, "stock") && (
            <details className="rv-card rv-extra rv-home-extra">
              <summary>
                <Package />
                Stok produk
                <span className="rv-note">
                  {data.products.filter((p) => p.tracked).length} jenis
                </span>
                <ChevronDown />
              </summary>
              {data.products
                .filter((p) => p.tracked)
                .map((p) => (
                  <div className="rv-line" key={p.id}>
                    <span>{p.name}</span>
                    <strong className={p.stock < 0 ? "negative" : ""}>
                      {p.stock} unit
                    </strong>
                  </div>
                ))}
            </details>
          )}
        </main>
      </div>
    );
  }
  function ProductSales({ rows }) {
    return (
      <section
        className="rv-card rv-product-sales"
        aria-label="Jumlah produk terjual"
      >
        <div className="rv-section-heading">
          <h3>
            <Package size={15} /> Produk terjual
          </h3>
          <span className="rv-note">Jumlah unit</span>
        </div>
        {rows ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Produk</th>
                <th scope="col">Delivery</th>
                <th scope="col">Take Away</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => !row.subtotal)
                .map((row) => (
                  <tr
                    key={row.key}
                    className={
                      row.subtotal ? "rv-product-sales-subtotal" : undefined
                    }
                  >
                    <th scope="row">{row.label}</th>
                    <td>{row.delivery.toLocaleString("id-ID")}</td>
                    <td>{row.counter.toLocaleString("id-ID")}</td>
                    <td>
                      <strong>{row.total.toLocaleString("id-ID")}</strong>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="rv-note">Memuat jumlah produk…</p>
        )}
      </section>
    );
  }
  function CashHolders({ rows = [], cash, qris }) {
    return (
      <section
        className="rv-card rv-cash-holders"
        aria-label="Penerimaan pembayaran per akun"
      >
        <div className="rv-section-heading">
          <h3>
            <Banknote size={15} /> Penerimaan pembayaran
          </h3>
          <strong>{money(cash + qris)}</strong>
        </div>
        {rows.map((row) => (
          <details className="rv-cash-holder rv-finance-account" key={row.key}>
            <summary className="rv-cash-holder-toggle">
              <strong>
                {row.channel === "delivery" ? (
                  <Truck size={14} />
                ) : (
                  <Store size={14} />
                )}
                <span className="rv-cash-holder-name">
                  {row.channel === "delivery"
                    ? "Delivery " + row.name
                    : "Depot / Take Away"}
                </span>
              </strong>
              <span className="rv-cash-holder-header-values">
                <b aria-label={"Total diterima " + money(row.cash + row.qris)}>
                  {money(row.cash + row.qris)}
                </b>
                <small>
                  {[
                    [row.galon, "galon"],
                    [row.tabung, "tabung"],
                    [row.unit, "unit"],
                  ]
                    .filter(([qty]) => qty > 0)
                    .map(
                      ([qty, unit]) => qty.toLocaleString("id-ID") + " " + unit,
                    )
                    .join(" · ") || "0 galon"}
                </small>
              </span>
              <ChevronDown size={16} />
            </summary>
            <div className="rv-cash-holder-body">
              {[
                ["Tunai", row.saleCash, row.debtCash, row.cash],
                ["QRIS", row.saleQris, row.debtQris, row.qris],
              ].map(([label, sale, debt, total]) => (
                <div className="rv-receipt-method" key={label}>
                  <span className="rv-receipt-method-label">
                    {label === "Tunai" ? (
                      <Banknote size={12} />
                    ) : (
                      <ScanLine size={12} />
                    )}
                    {label}
                  </span>
                  <dl aria-label={label}>
                    <div>
                      <dt>Pesanan</dt>
                      <dd>{money(sale || 0)}</dd>
                    </div>
                    <div>
                      <dt>Bayar utang</dt>
                      <dd>{money(debt || 0)}</dd>
                    </div>
                    <div>
                      <dt>Total {label === "QRIS" ? label : "tunai"}</dt>
                      <dd>{money(total || 0)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
              {row.channel === "counter" && row.actors.length > 0 && (
                <small className="rv-cash-depot-actors">
                  {row.actors.map((actor) => actor.name).join(" · ")}
                </small>
              )}
            </div>
          </details>
        ))}
      </section>
    );
  }
  function SelectedProducts({
    lines,
    onChange,
    discounts,
    onDiscountChange,
    editable = true,
    compact = false,
  }) {
    const { data } = useApp();
    function lineLabel(line) {
      const product = [...data.products, ...(data.archivedProducts || [])].find(
        (p) => p.id === line.productId,
      );
      const mode = product?.modes.find((m) => m.id === line.modeId);
      return product && mode
        ? productChoiceLabel(product, mode)
        : line.name.toUpperCase();
    }
    function changeQuantity(line, delta) {
      onChange(
        lines
          .map((l) =>
            l.modeId === line.modeId ? { ...l, qty: l.qty + delta } : l,
          )
          .filter((l) => l.qty > 0),
      );
    }
    if (!lines.length) return null;
    return (
      <section
        className={
          "rv-selected-products" + (compact ? " rv-selected-compact" : "")
        }
        aria-label="Rincian produk dipilih"
      >
        <div className="rv-selected-heading">
          <h4>Rincian pesanan</h4>
          <span>{lines.reduce((n, l) => n + l.qty, 0)} item</span>
        </div>
        {compact && onDiscountChange && (
          <div className="rv-selected-column-labels" aria-hidden="true">
            <span>Produk</span>
            <span>Jumlah</span>
            <span>Subtotal</span>
            <span>Diskon (Rp)</span>
          </div>
        )}
        {[...new Set(lines.map((l) => l.productId))].map((key) => {
          const grouped = lines.filter((l) => l.productId === key);
          const subtotal = grouped.reduce((n, l) => n + l.qty * l.price, 0);
          return (
            <div
              className={
                "rv-selected-product" +
                (onDiscountChange ? " rv-selected-with-discount" : "")
              }
              key={key}
            >
              <div className="rv-selected-lines">
                {grouped.map((line) => (
                  <div className="rv-selected-line" key={line.modeId}>
                    <span title={lineLabel(line)}>
                      <strong>{lineLabel(line)}</strong>
                    </span>
                    {editable ? (
                      <div className="rv-quantity-control">
                        <button
                          type="button"
                          aria-label={"Kurangi " + lineLabel(line)}
                          onClick={() => changeQuantity(line, -1)}
                        >
                          <Minus />
                        </button>
                        <strong>{line.qty}</strong>
                        <button
                          type="button"
                          aria-label={"Tambah " + lineLabel(line)}
                          onClick={() => changeQuantity(line, 1)}
                        >
                          <Plus />
                        </button>
                      </div>
                    ) : (
                      <span className="rv-selected-quantity">{line.qty} ×</span>
                    )}
                    <strong className="rv-selected-subtotal">
                      {money(line.qty * line.price)}
                    </strong>
                  </div>
                ))}
              </div>
              {onDiscountChange && (
                <label className="rv-selected-discount">
                  <span>Diskon (Rp)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label={"Diskon " + grouped[0].name}
                    title={
                      grouped.length > 1
                        ? "Diskon " + grouped[0].name + " untuk semua varian"
                        : undefined
                    }
                    min="0"
                    max={subtotal}
                    step="1"
                    placeholder="0"
                    value={discounts[key] || ""}
                    onChange={(e) =>
                      onDiscountChange({ ...discounts, [key]: e.target.value })
                    }
                  />
                </label>
              )}
            </div>
          );
        })}
      </section>
    );
  }
  function ProductPicker({
    lines,
    onChange,
    showSelected = true,
    discounts,
    onDiscountChange,
    compactSelected = false,
  }) {
    const { data } = useApp(),
      [category, setCategory] = useState(data.categories[0]?.id || "");
    function adjust(p, m, delta) {
      const index = lines.findIndex((l) => l.modeId === m.id);
      onChange(
        index < 0 && delta > 0
          ? [
              ...lines,
              {
                productId: p.id,
                modeId: m.id,
                name: p.name,
                mode: m.name,
                price: m.price,
                qty: 1,
              },
            ]
          : lines
              .map((l, i) =>
                i === index ? { ...l, qty: l.qty + delta, price: m.price } : l,
              )
              .filter((l) => l.qty > 0),
      );
    }
    return (
      <>
        <div
          className="rv-category-chips"
          role="group"
          aria-label="Kategori produk pesanan"
        >
          {data.categories.map((c) => (
            <button
              type="button"
              key={c.id}
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="rv-product-tiles">
          {data.products
            .filter((p) => p.category_id === category)
            .flatMap((p) =>
              p.modes.map((m) => (
                <button
                  type="button"
                  className="rv-product-pick"
                  key={m.id}
                  data-picked={lines.some((line) => line.modeId === m.id)}
                  onClick={() => adjust(p, m, 1)}
                >
                  <span>
                    <strong>{productChoiceLabel(p, m)}</strong>
                    <small>{money(m.price)}</small>
                  </span>
                  <span className="rv-product-pick-count">
                    {lines.find((l) => l.modeId === m.id)?.qty || "+"}
                  </span>
                </button>
              )),
            )}
        </div>
        {showSelected && (
          <SelectedProducts
            lines={lines}
            onChange={onChange}
            discounts={discounts}
            onDiscountChange={onDiscountChange}
            compact={compactSelected}
          />
        )}
        {!data.products.length && (
          <Empty>Tambahkan produk terlebih dahulu.</Empty>
        )}
      </>
    );
  }
  function Orders() {
    const { data, act, tick, refresh } = useApp(),
      [filter, setFilter] = useState(() => {
        const key = window.location.hash.split("?")[1]?.split("&")[0];
        return key === "all" || filters[key] ? key : "orders";
      }),
      [scope] = useState(
        () => new URLSearchParams(window.location.hash.split("?")[1] || ""),
      ),
      [period, setPeriod] = useState(() => {
        const from = scope.get("from"),
          to = scope.get("to");
        if (
          [from, to].every(
            (value) =>
              /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
              !Number.isNaN(Date.parse(value)),
          ) &&
          from <= to
        )
          return { kind: "range", from, to };
        const ids = (scope.get("selected") || "").split(",");
        const days = data.orders
          .filter((order) => ids.includes(order.id))
          .map((order) =>
            new Date(Date.parse(order.created_at) + 7 * 3600000)
              .toISOString()
              .slice(0, 10),
          )
          .sort();
        if (
          days.length &&
          (days[0] !== data.today || days.at(-1) !== data.today)
        )
          return { kind: "range", from: days[0], to: days.at(-1) };
        return { kind: "today", from: data.today, to: data.today };
      }),
      [search, setSearch] = useState(""),
      [pages, setPages] = useState({ key: "", cursors: [null], index: 0 }),
      [selected, setSelected] = useState(
        () =>
          new URLSearchParams(window.location.hash.split("?")[1] || "")
            .get("selected")
            ?.split(",")
            .filter(Boolean) || [],
      ),
      [menu, setMenu] = useState(""),
      [productEditor, setProductEditor] = useState(null),
      [productError, setProductError] = useState(""),
      [reason, setReason] = useState(""),
      [cancelling, setCancelling] = useState(false),
      range = periodDates(data.today, period),
      historyQuery = new URLSearchParams({
        from: range.from,
        to: range.to,
        filter,
        search,
      }).toString(),
      navigation =
        pages.key === historyQuery
          ? pages
          : { key: historyQuery, cursors: [null], index: 0 },
      cursor = navigation.cursors[navigation.index],
      [periodOrders, periodError] = useResource(
        "/orders?" +
          historyQuery +
          "&limit=50" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        { keepPrevious: true, resetKey: historyQuery + ":" + (cursor || "") },
      );
    useEffect(() => {
      window.scrollTo(0, 0);
    }, [historyQuery, cursor]);
    function changePeriod(value) {
      setPeriod(value);
      setSelected([]);
      setMenu("");
      setProductEditor(null);
      setProductError("");
      setCancelling(false);
    }
    function changePage(next) {
      setMenu("");
      setProductEditor(null);
      setCancelling(false);
      setPages(next);
    }
    const selectedOrders = data.orders.filter(
      (o) =>
        selected.includes(o.id) &&
        o.kind === "delivery" &&
        ["new", "pickup", "fill", "failed", "partial"].includes(o.status),
    );
    useEffect(() => {
      const eligible = new Set(
        data.orders
          .filter(
            (o) =>
              o.kind === "delivery" &&
              ["new", "pickup", "fill", "failed", "partial"].includes(o.status),
          )
          .map((o) => o.id),
      );
      setSelected((previous) =>
        previous.every((id) => eligible.has(id))
          ? previous
          : previous.filter((id) => eligible.has(id)),
      );
    }, [data.orders]);
    const shown = [...(periodOrders?.orders || [])].sort(
      (a, b) => duration(b, tick) - duration(a, tick),
    );
    async function status(o, value) {
      await act(async () => {
        await api("/orders/" + o.id + "/status", {
          method: "PATCH",
          body: { version: o.version, status: value, reason },
        });
        setMenu("");
        setCancelling(false);
      }).catch(() => {});
    }
    return (
      <>
        <Header
          title="Pesanan"
          icon={ClipboardList}
          className="rv-orders-header"
          filters={
            <PeriodFilters
              value={period}
              onChange={changePeriod}
              today={data.today}
              label="Periode pesanan"
            />
          }
          search={search}
          onSearch={setSearch}
        >
          {(can(data.user, "orders") || can(data.user, "counter")) && (
            <button className="rv-header-button" onClick={() => go("neworder")}>
              <Plus />
              Pesanan
            </button>
          )}
        </Header>
        <main
          className={
            "rv-body rv-orders-body" +
            (selectedOrders.length ? " rv-has-selection" : "")
          }
        >
          <div className="rv-filters">
            {["all", ...Object.keys(filters)].map((key) => (
              <button
                className="rv-filter"
                key={key}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setMenu("");
                  setProductEditor(null);
                }}
              >
                {key === "all" ? "Semua" : filterLabels[key]}
              </button>
            ))}
          </div>
          <div className="rv-section-heading">
            <h3>
              {shown.length} {filter === "failed" ? "gagal / batal" : "pesanan"}
            </h3>
            <span className="rv-note">
              {dateLabel(range.from)}
              {range.from !== range.to ? " – " + dateLabel(range.to) : ""}
              {(navigation.index > 0 || periodOrders?.hasMore) &&
                " · Halaman " + (navigation.index + 1)}
            </span>
          </div>
          {periodError && <span className="rv-error">{periodError}</span>}
          {!periodOrders && !periodError && (
            <p className="rv-note" role="status">
              Memuat pesanan…
            </p>
          )}
          <div className="rv-list">
            {shown.map((o) => (
              <article className="rv-order" key={o.id}>
                <div className="rv-order-grid">
                  <div className="rv-select-row">
                    <input
                      type="checkbox"
                      id={"select-order-" + o.id}
                      aria-label={"Pilih " + o.name + " untuk trip"}
                      checked={selected.includes(o.id)}
                      disabled={
                        !can(data.user, "trips") ||
                        o.kind !== "delivery" ||
                        ![
                          "new",
                          "pickup",
                          "fill",
                          "failed",
                          "partial",
                        ].includes(o.status)
                      }
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, o.id]
                            : s.filter((id) => id !== o.id),
                        )
                      }
                    />
                    <span>
                      <label htmlFor={"select-order-" + o.id}>
                        <Identity code={o.code} name={o.name} />
                      </label>
                      <span className="rv-order-products">
                        {can(data.user, "orders") &&
                        o.kind === "delivery" &&
                        [
                          "new",
                          "pickup",
                          "fill",
                          "failed",
                          "partial",
                          "delivery",
                        ].includes(o.status) ? (
                          <button
                            type="button"
                            className={
                              "rv-order-product-action" +
                              (!o.items.length ? " rv-order-product-empty" : "")
                            }
                            aria-label={
                              (o.items.length
                                ? "Ubah produk "
                                : "Isi produk ") + o.name
                            }
                            aria-expanded={productEditor?.id === o.id}
                            aria-controls={"order-products-" + o.id}
                            onClick={() => {
                              setProductEditor(
                                productEditor?.id === o.id
                                  ? null
                                  : {
                                      id: o.id,
                                      version: o.version,
                                      discounts: o.discounts || {},
                                      lines: o.items.map((line) => ({
                                        ...line,
                                        price:
                                          o.prepayment?.amount > 0
                                            ? line.price
                                            : (data.products
                                                .find(
                                                  (p) =>
                                                    p.id === line.productId,
                                                )
                                                ?.modes.find(
                                                  (m) => m.id === line.modeId,
                                                )?.price ?? line.price),
                                      })),
                                    },
                              );
                              setProductError("");
                              setMenu("");
                            }}
                          >
                            {o.items.length ? (
                              <>
                                {orderProductSummary(o)}
                                <SquarePen size={12} />
                              </>
                            ) : (
                              <>
                                <Plus size={13} /> Isi produk
                              </>
                            )}
                          </button>
                        ) : (
                          orderProductSummary(o) || "Produk belum diisi"
                        )}
                      </span>
                    </span>
                  </div>
                  <div className="rv-order-rail">
                    <DurationChip
                      minutes={duration(o, tick)}
                      settings={data.settings}
                    />
                    {o.status === "delivery" ? (
                      <span className="rv-delivery-label">
                        Antar — {o.courier}
                      </span>
                    ) : ["done", "failed", "cancel"].includes(o.status) ? (
                      <span className="rv-terminal-label">
                        {statuses[o.status]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rv-status-button"
                        disabled={!can(data.user, "orders")}
                        aria-label={"Ubah status " + o.name}
                        aria-expanded={menu === o.id}
                        onClick={() => {
                          setMenu(menu === o.id ? "" : o.id);
                          setCancelling(false);
                          setProductEditor(null);
                        }}
                      >
                        {statuses[o.status]}
                        <ChevronDown />
                      </button>
                    )}
                  </div>
                </div>
                <OrderQuantityNote revision={o.revision} />
                {["cancel", "failed"].includes(o.status) && o.reason && (
                  <p className="rv-order-reason">
                    <span>
                      {o.status === "cancel" ? "Alasan batal" : "Alasan gagal"}
                    </span>
                    {o.reason}
                  </p>
                )}
                {o.prepayment?.settled && (
                  <span className="rv-paid-badge rv-order-paid">
                    <BadgeCheck size={14} />
                    Lunas · {o.prepayment.method}
                  </span>
                )}
                {productEditor?.id === o.id && (
                  <AppForm
                    id={"order-products-" + o.id}
                    className="rv-order-product-editor"
                    aria-label={"Produk pesanan " + o.name}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setProductError("");
                      await act(async () => {
                        await api("/orders/" + o.id + "/items", {
                          method: "PATCH",
                          body: {
                            version: productEditor.version,
                            items: productEditor.lines,
                            discounts: Object.fromEntries(
                              [
                                ...new Set(
                                  productEditor.lines.map(
                                    (line) => line.productId,
                                  ),
                                ),
                              ].map((key) => [
                                key,
                                Number(productEditor.discounts[key] || 0),
                              ]),
                            ),
                          },
                        });
                        setProductEditor(null);
                      }).catch(async (err) => {
                        setProductError(err.message);
                        if (err.status === 409) await refresh().catch(() => {});
                      });
                    }}
                  >
                    <div className="rv-section-heading">
                      <h3>
                        <Package size={14} /> Produk pesanan
                      </h3>
                      <button
                        type="button"
                        className="rv-order-editor-close"
                        aria-label="Tutup isian produk"
                        onClick={() => setProductEditor(null)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <ProductPicker
                      compactSelected
                      lines={productEditor.lines}
                      discounts={productEditor.discounts}
                      onDiscountChange={(discounts) =>
                        setProductEditor((previous) => ({
                          ...previous,
                          discounts,
                        }))
                      }
                      onChange={(lines) =>
                        setProductEditor((previous) => ({ ...previous, lines }))
                      }
                    />
                    {productError && (
                      <p className="rv-error" role="alert">
                        {productError}
                      </p>
                    )}
                    <Submit disabled={!productEditor.lines.length}>
                      Simpan produk
                    </Submit>
                  </AppForm>
                )}
                {menu === o.id && (
                  <div className="rv-status-panel">
                    <div className="rv-status-choices">
                      {["pickup", "fill"].map((s) => (
                        <button
                          className="rv-status-choice"
                          key={s}
                          onClick={() => status(o, s)}
                        >
                          {statuses[s]}
                        </button>
                      ))}
                      <button
                        className="rv-status-choice rv-cancel-choice"
                        onClick={() => setCancelling(true)}
                      >
                        Batal
                      </button>
                    </div>
                    {cancelling && (
                      <AppForm
                        className="rv-stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          status(o, "cancel");
                        }}
                      >
                        <Field label="Alasan batal">
                          <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            required
                            rows={2}
                          />
                        </Field>
                        <Submit>Catat batal</Submit>
                      </AppForm>
                    )}
                  </div>
                )}
              </article>
            ))}
            {periodOrders && !shown.length && (
              <div className="rv-card rv-note">
                Belum ada pesanan pada tanggal dan status ini.
              </div>
            )}
          </div>
          {(navigation.index > 0 || periodOrders?.hasMore) && (
            <nav className="rv-orders-pagination" aria-label="Halaman pesanan">
              <button
                type="button"
                className="rv-secondary"
                disabled={!periodOrders || navigation.index === 0}
                onClick={() =>
                  changePage({ ...navigation, index: navigation.index - 1 })
                }
              >
                Sebelumnya
              </button>
              <span>Halaman {navigation.index + 1}</span>
              <button
                type="button"
                className="rv-secondary"
                disabled={!periodOrders?.hasMore}
                onClick={() =>
                  changePage({
                    ...navigation,
                    cursors: [
                      ...navigation.cursors.slice(0, navigation.index + 1),
                      periodOrders.nextCursor,
                    ],
                    index: navigation.index + 1,
                  })
                }
              >
                Berikutnya
              </button>
            </nav>
          )}
          {selectedOrders.length > 0 && (
            <div className="rv-selection">
              <span>{selectedOrders.length} pesanan dipilih</span>
              <button
                className="rv-primary rv-small"
                onClick={() =>
                  go(
                    "departure?orders=" +
                      encodeURIComponent(
                        selectedOrders.map((order) => order.id).join(","),
                      ),
                  )
                }
              >
                Siapkan trip
                <ChevronRight />
              </button>
            </div>
          )}
        </main>
      </>
    );
  }
  function Departure() {
    const { data, act } = useApp();
    const [photo, setPhoto] = useState("");
    const [ids] = useState(() => [
      ...new Set(
        (
          new URLSearchParams(window.location.hash.split("?")[1] || "").get(
            "orders",
          ) || ""
        )
          .split(",")
          .filter(Boolean),
      ),
    ]);
    const orders = data.orders.filter(
      (order) =>
        ids.includes(order.id) &&
        order.kind === "delivery" &&
        ["new", "pickup", "fill", "failed", "partial"].includes(order.status),
    );
    const valid = ids.length > 0 && orders.length === ids.length;
    return (
      <AppForm
        className="rv-departure-page"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || !photo) return;
          await act(async () => {
            await api("/trips", {
              method: "POST",
              body: { orderIds: ids, photo },
            });
            go("trips");
          }).catch(() => {});
        }}
      >
        <header className="rv-departure-top">
          <span className="rv-departure-symbol">
            <Truck size={22} />
          </span>
          <span className="rv-departure-title">
            <strong>Keberangkatan trip</strong>
            <small>
              <b>Trip ke-{data.nextTripNumber ?? "…"}</b> · {orders.length}{" "}
              pesanan · {data.user.name}
            </small>
          </span>
          <button
            type="button"
            className="rv-icon-button"
            aria-label="Kembali ke pesanan"
            onClick={() =>
              go("orders?selected=" + encodeURIComponent(ids.join(",")))
            }
          >
            <X size={22} />
          </button>
        </header>
        {valid ? (
          <DepartureCamera photo={photo} onChange={setPhoto} />
        ) : (
          <div className="rv-departure-unavailable">
            Pilihan pesanan sudah berubah. Kembali untuk memilih pesanan.
          </div>
        )}
        <div className="rv-departure-bottom">
          <Submit disabled={!photo || !valid}>Mulai trip</Submit>
        </div>
      </AppForm>
    );
  }
  function NewOrder({ initialCounter = false }) {
    const { act, data } = useApp(),
      [atDepot, setAtDepot] = useState(
        initialCounter || !can(data.user, "orders"),
      ),
      [customer, setCustomer] = useState(""),
      [guest, setGuest] = useState(""),
      [source, setSource] = useState("WhatsApp"),
      [time, setTime] = useState(
        timeLabel(new Date().toISOString()).replace(".", ":"),
      ),
      [lines, setLines] = useState([]),
      [discounts, setDiscounts] = useState({}),
      [payNow, setPayNow] = useState(false),
      [payMethod, setPayMethod] = useState(""),
      [shipping, setShipping] = useState("");
    const orderDiscounts = Object.fromEntries(
      [...new Set(lines.map((line) => line.productId))].map((key) => [
        key,
        Number(discounts[key] || 0),
      ]),
    );
    const orderTotal =
      lines.reduce((sum, line) => sum + line.qty * line.price, 0) -
      Object.values(orderDiscounts).reduce((sum, value) => sum + value, 0) +
      (payNow ? Number(shipping || 0) : 0);
    const paymentSection = (
      <section className="rv-stack rv-payment-simple rv-new-order-payment">
        <div className="rv-payment-heading">
          <span>
            <Wallet size={16} />
            <strong>Pembayaran</strong>
          </span>
          <strong>{money(orderTotal)}</strong>
        </div>
        <div
          className="rv-payment-timing"
          role="group"
          aria-label="Pembayaran pesanan diantar"
        >
          <button
            type="button"
            aria-pressed={!payNow}
            onClick={() => setPayNow(false)}
          >
            Bayar ke kurir
          </button>
          <button
            type="button"
            aria-pressed={payNow}
            onClick={() => setPayNow(true)}
          >
            Bayar sekarang
          </button>
        </div>
        {payNow && (
          <div className="rv-two">
            <Field label="Metode">
              <select
                aria-label="Metode pembayaran"
                required
                value={payMethod}
                onChange={(event) => setPayMethod(event.target.value)}
              >
                <option value="">Pilih metode</option>
                <option>Tunai</option>
                <option>QRIS</option>
              </select>
            </Field>
            <Currency
              label="Ongkir (Rp)"
              placeholder="0"
              value={shipping}
              onChange={setShipping}
            />
          </div>
        )}
      </section>
    );
    const customerCard = (
      <div className="rv-card rv-stack rv-new-customer">
        <h3>Pesanan masuk</h3>
        <CustomerPicker
          value={customer}
          onChange={setCustomer}
          guestName={guest}
          onGuestChange={setGuest}
        />
        {can(data.user, "orders") && can(data.user, "counter") && (
          <div
            className="rv-service-mode"
            role="group"
            aria-label="Penyerahan pesanan"
          >
            <button
              type="button"
              aria-pressed={!atDepot}
              onClick={() => setAtDepot(false)}
            >
              Diantar
            </button>
            <button
              type="button"
              aria-pressed={atDepot}
              onClick={() => setAtDepot(true)}
            >
              Ambil di depot
            </button>
          </div>
        )}
        {!atDepot && (
          <div className="rv-two">
            <Field label="Lewat">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {["WhatsApp", "Telepon", "Depot", "Kurir"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Jam masuk"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
          </div>
        )}
        {!atDepot && paymentSection}
      </div>
    );
    return (
      <>
        <Header
          title="Tambah pesanan"
          icon={ShoppingBag}
          back={canAccessPage(data.user, "orders") ? "orders" : "home"}
        />
        <main className="rv-body">
          {atDepot ? (
            <Checkout
              counter
              customerSection={customerCard}
              lines={lines}
              onLinesChange={setLines}
              customerId={customer}
              guestName={guest}
              discounts={discounts}
              onDiscountChange={setDiscounts}
              onSaved={() =>
                go(canAccessPage(data.user, "orders") ? "orders?done" : "home")
              }
            />
          ) : (
            <AppForm
              className="rv-stack rv-new-order-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await act(async () => {
                  await api("/orders", {
                    method: "POST",
                    body: {
                      customerId: customer,
                      guestName: guest,
                      source,
                      receivedTime: time,
                      items: lines,
                      discounts: orderDiscounts,
                      paymentTiming: payNow ? "now" : "courier",
                      method: payNow ? payMethod : undefined,
                      shipping: payNow ? Number(shipping || 0) : 0,
                    },
                  });
                  go("orders");
                }).catch(() => {});
              }}
            >
              {customerCard}
              <div className="rv-card rv-stack rv-new-products">
                <div className="rv-section-heading">
                  <h3>Produk</h3>
                </div>
                <ProductPicker
                  lines={lines}
                  onChange={setLines}
                  discounts={discounts}
                  onDiscountChange={setDiscounts}
                />
              </div>
              <Submit disabled={payNow && !lines.length}>Simpan pesanan</Submit>
            </AppForm>
          )}
        </main>
      </>
    );
  }
  function OrderQuantityEditor({ order, onClose }) {
    const { act } = useApp(),
      [lines, setLines] = useState(order.items),
      [error, setError] = useState("");
    return (
      <AppForm
        className="rv-card rv-stack rv-order-quantity-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          await act(async () => {
            await api("/orders/" + order.id + "/items", {
              method: "PATCH",
              body: { version: order.version, items: lines },
            });
            onClose();
          }).catch((err) => setError(err.message));
        }}
      >
        <div className="rv-section-heading">
          <h3>
            {order.items.length ? "Edit jumlah pesanan" : "Isi produk pesanan"}
          </h3>
          <button
            type="button"
            className="rv-icon-button"
            aria-label="Tutup edit jumlah"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <p className="rv-note">
          Isi jumlah akhir pesanan. Perubahan dan akun pengedit akan dicatat.
        </p>
        <ProductPicker lines={lines} onChange={setLines} showSelected={false} />
        <SelectedProducts lines={lines} onChange={setLines} editable />
        {error && <p className="rv-error">{error}</p>}
        <Submit disabled={!lines.length}>Simpan jumlah pesanan</Submit>
      </AppForm>
    );
  }
  function Checkout({
    order,
    trip,
    onSaved,
    onTotalChange,
    counter = false,
    customerSection,
    customerId,
    guestName,
    lines: externalLines,
    onLinesChange,
    discounts: externalDiscounts,
    onDiscountChange,
  }) {
    const { act } = useApp(),
      [internal, setInternal] = useState(
        order?.progress?.remainingItems || order?.items || [],
      ),
      lines = externalLines || internal,
      setLines = onLinesChange || setInternal,
      [internalDiscounts, setInternalDiscounts] = useState(
        order?.progress?.remainingDiscounts ||
          (order?.prepayment?.settled
            ? order.prepayment.discounts
            : order?.discounts || {}),
      ),
      discounts = externalDiscounts || internalDiscounts,
      setDiscounts = onDiscountChange || setInternalDiscounts,
      [shipping, setShipping] = useState(
        String(
          order?.prepayment && !order.progress?.deliveredQty
            ? order.prepayment.shipping
            : 0,
        ),
      ),
      [payment, setPayment] = useState({ method: "", paid: "0" }),
      [paidEdited, setPaidEdited] = useState(false),
      [outcome, setOutcome] = useState(""),
      [reason, setReason] = useState(""),
      [proofOpen, setProofOpen] = useState(false);
    const [payNow, setPayNow] = useState(false);
    const registered = counter ? !!customerId : !!order?.customer_id;
    const payLater = counter && registered && !payNow;
    const productIds = [...new Set(lines.map((l) => l.productId))],
      total =
        lines.reduce((n, l) => n + l.qty * l.price, 0) -
        productIds.reduce((n, key) => n + Number(discounts[key] || 0), 0) +
        (counter ? 0 : Number(shipping));
    const advanceUsed = counter
      ? 0
      : Math.min(order?.prepayment?.available || 0, total);
    const due = total - advanceUsed;
    const prepaid = !counter && !!order?.prepayment && due === 0;
    const paidAmount = prepaid
      ? 0
      : payLater
        ? 0
        : counter
          ? total
          : payment.method === "Utang"
            ? 0
            : Number(payment.paid);
    useEffect(() => onTotalChange?.(total), [total]);
    useEffect(() => {
      if (!paidEdited) setPayment((p) => ({ ...p, paid: String(due) }));
    }, [due, paidEdited]);
    useEffect(() => {
      if (!registered && payment.method === "Utang") {
        setPayment((p) => ({ ...p, method: "", paid: String(total) }));
        setPaidEdited(false);
      }
    }, [registered, payment.method, total]);
    const set = (key, value) => {
      if (key === "paid") setPaidEdited(true);
      setPayment((p) => ({ ...p, [key]: value }));
    };
    async function save(e) {
      e.preventDefault();
      await act(async () => {
        await api(
          counter ? "/counter" : `/trips/${trip.id}/orders/${order.id}/result`,
          {
            method: "POST",
            body: outcome
              ? { outcome, reason, version: order?.version }
              : {
                  outcome: "done",
                  version: order?.version,
                  items: lines,
                  discounts: Object.fromEntries(
                    productIds.map((key) => [key, Number(discounts[key] || 0)]),
                  ),
                  shipping: Number(shipping),
                  paid: paidAmount,
                  method: payLater ? "Utang" : payment.method,
                  ...(counter
                    ? { paymentTiming: payLater ? "later" : "now" }
                    : {}),
                  tender:
                    payLater ||
                    payment.method !== "Tunai" ||
                    payment.tender == null ||
                    payment.tender === ""
                      ? null
                      : Number(payment.tender),
                  proof:
                    !payLater && payment.method === "QRIS"
                      ? payment.proof
                      : undefined,
                  customerId,
                  guestName,
                },
          },
        );
        onSaved();
      }).catch(() => {});
    }
    return (
      <AppForm
        className={"rv-stack" + (counter ? "" : " rv-trip-checkout")}
        onSubmit={save}
      >
        {customerSection}
        {!counter && (
          <div className="rv-inline-heading">
            <span>Pembayaran</span>
            <strong className="rv-trip-payment-total">{money(total)}</strong>
            {!counter && (
              <button
                type="button"
                className="rv-icon-button"
                aria-label="Tutup pembayaran"
                onClick={onSaved}
              >
                <X />
              </button>
            )}
          </div>
        )}
        {counter && (
          <div className="rv-card rv-product-card">
            <div className="rv-section-heading">
              <h3>Produk</h3>
            </div>
            <ProductPicker
              lines={lines}
              onChange={setLines}
              showSelected={false}
            />
            <SelectedProducts
              lines={lines}
              onChange={setLines}
              discounts={discounts}
              onDiscountChange={prepaid ? undefined : setDiscounts}
              editable={counter}
            />
          </div>
        )}
        <div className="rv-card rv-stack rv-payment-card rv-payment-simple">
          {counter && (
            <div className="rv-payment-heading">
              <span>
                <Wallet size={16} />
                <strong>Pembayaran</strong>
              </span>
              <strong>{money(total)}</strong>
            </div>
          )}
          {prepaid ? (
            <>
              <span className="rv-paid-badge">
                <BadgeCheck size={17} />
                Dibayar di muka · {money(advanceUsed)}
              </span>
              {(Number(shipping) > 0 ||
                Object.values(discounts).some(
                  (value) => Number(value) > 0,
                )) && (
                <small className="rv-note">
                  {[
                    Object.values(discounts).reduce(
                      (sum, value) => sum + Number(value || 0),
                      0,
                    ) > 0
                      ? "Diskon −" +
                        money(
                          Object.values(discounts).reduce(
                            (sum, value) => sum + Number(value || 0),
                            0,
                          ),
                        )
                      : "",
                    Number(shipping) > 0
                      ? "Ongkir " + money(Number(shipping))
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              )}
            </>
          ) : (
            <>
              {advanceUsed > 0 && (
                <p className="rv-note">
                  Pembayaran di muka digunakan {money(advanceUsed)} · Sisa
                  dibayar {money(due)}
                </p>
              )}
              {counter && registered && (
                <div
                  className="rv-payment-timing"
                  role="group"
                  aria-label="Waktu pembayaran"
                >
                  <button
                    type="button"
                    aria-pressed={!payNow}
                    onClick={() => setPayNow(false)}
                  >
                    Bayar nanti
                  </button>
                  <button
                    type="button"
                    aria-pressed={payNow}
                    onClick={() => setPayNow(true)}
                  >
                    Bayar sekarang
                  </button>
                </div>
              )}
              {payLater ? (
                <p className="rv-payment-note">
                  Dicatat sebagai utang pelanggan. Pembayaran bisa dimasukkan
                  melalui halaman Utang.
                </p>
              ) : (
                <>
                  <div
                    className={(counter ? "" : "rv-two ") + "rv-payment-inputs"}
                  >
                    <Field label="Metode">
                      <select
                        value={payment.method}
                        onChange={(e) => set("method", e.target.value)}
                        required
                      >
                        <option value="">Pilih metode</option>
                        <option>Tunai</option>
                        <option>QRIS</option>
                        {!counter && (
                          <option value="Utang" disabled={!registered}>
                            Belum bayar
                          </option>
                        )}
                      </select>
                    </Field>
                    {!counter && payment.method !== "Utang" && (
                      <Currency
                        label="Dibayar (Rp)"
                        value={payment.method === "Utang" ? "0" : payment.paid}
                        onChange={(v) => set("paid", v)}
                        min={registered ? 0 : due}
                        max={due}
                        required
                      />
                    )}
                  </div>
                  {!counter && (
                    <div className="rv-two rv-trip-adjustment-fields">
                      <Currency
                        label="Ongkir (Rp)"
                        value={shipping}
                        onChange={setShipping}
                        disabled={!!order.prepayment}
                      />
                      {productIds.map((productId) => (
                        <Currency
                          key={productId}
                          label={
                            "Diskon " +
                            lines.find((line) => line.productId === productId)
                              .name +
                            " (Rp)"
                          }
                          value={discounts[productId] ?? "0"}
                          onChange={(value) =>
                            setDiscounts({ ...discounts, [productId]: value })
                          }
                          max={lines
                            .filter((line) => line.productId === productId)
                            .reduce(
                              (sum, line) => sum + line.qty * line.price,
                              0,
                            )}
                          disabled={!!order.prepayment}
                        />
                      ))}
                      {order.prepayment && (
                        <p className="rv-note">
                          Mengikuti pembayaran di muka yang sudah dicatat.
                        </p>
                      )}
                    </div>
                  )}
                  {!counter && (
                    <div className="rv-payment-balance">
                      <span className="rv-note">Sisa utang</span>
                      <strong>{money(due - paidAmount)}</strong>
                    </div>
                  )}
                  {!counter && payment.method === "Tunai" && (
                    <details className="rv-extra">
                      <summary>
                        Hitung kembalian
                        <ChevronDown />
                      </summary>
                      <Currency
                        label="Uang tunai yang diserahkan (Rp)"
                        value={payment.tender ?? ""}
                        onChange={(v) => set("tender", v)}
                      />
                      <div className="rv-line">
                        <span className="rv-note">Kembalian</span>
                        <strong>
                          {money(
                            Math.max(
                              0,
                              Number(payment.tender) - Number(payment.paid),
                            ),
                          )}
                        </strong>
                      </div>
                    </details>
                  )}
                  {!counter && payment.method === "QRIS" && (
                    <>
                      <button
                        className="rv-text-button"
                        type="button"
                        onClick={() => setProofOpen(!proofOpen)}
                      >
                        Tambah bukti QRIS (opsional)
                      </button>
                      {proofOpen && (
                        <input
                          type="file"
                          accept="image/*"
                          aria-label="Bukti QRIS"
                          onChange={async (e) =>
                            set("proof", await imageFile(e.target.files[0]))
                          }
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
          {!outcome && (
            <Submit disabled={!lines.length}>
              {counter ? "Simpan pesanan" : "Catat pengantaran"}
            </Submit>
          )}
        </div>
        {!counter && (
          <>
            <div className="rv-outcome-chips">
              {(prepaid ? ["failed"] : ["failed", "cancel"]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className="rv-outcome-chip"
                  aria-pressed={outcome === key}
                  onClick={() => setOutcome(outcome === key ? "" : key)}
                >
                  {statuses[key]}
                </button>
              ))}
            </div>
            {outcome && (
              <div className="rv-stack">
                <Field label={"Alasan " + statuses[outcome].toLowerCase()}>
                  <textarea
                    required
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Submit>Catat {statuses[outcome].toLowerCase()}</Submit>
              </div>
            )}
          </>
        )}
      </AppForm>
    );
  }
  function Trips() {
    const { data } = useApp(),
      [open, setOpen] = useState(null),
      [expanded, setExpanded] = useState(""),
      [editingOrder, setEditingOrder] = useState(""),
      [totals, setTotals] = useState({});
    const groups = groupTripsByNumber(data.trips, data.today),
      current = groups.filter((g) => g.active),
      previous = groups.filter((g) => !g.active);
    function renderRows(t) {
      return (
        <>
          {t.orders.map((row) => {
            const o = data.orders.find((o) => o.id === row.order_id),
              active = row.outcome === "delivery" && o,
              entryKey = t.id + ":" + row.order_id,
              OrderHeading = active ? "div" : "button";
            function closePanel() {
              setExpanded("");
              setEditingOrder("");
              setTotals((s) => {
                const next = { ...s };
                delete next[entryKey];
                return next;
              });
            }
            function togglePanel(edit = false) {
              if (
                expanded === entryKey &&
                (editingOrder === entryKey) === edit
              ) {
                closePanel();
              } else {
                setEditingOrder(edit ? entryKey : "");
                setExpanded(entryKey);
              }
            }
            const productSummary = (
              <span className="rv-trip-product-summary">
                <span className="rv-note">
                  {(active
                    ? o.progress?.remainingItems || row.items
                    : row.items
                  )
                    .map((l) => l.qty + " " + l.name)
                    .join(" + ") || "Produk belum diisi"}
                </span>
                {active && o.items.length > 0 && (
                  <button
                    type="button"
                    className="rv-text-button rv-trip-edit"
                    aria-label={"Edit pesanan " + row.name}
                    aria-expanded={
                      expanded === entryKey && editingOrder === entryKey
                    }
                    onClick={() => togglePanel(true)}
                  >
                    <SquarePen size={13} /> Edit
                  </button>
                )}
              </span>
            );
            if (t.closed_at)
              return (
                <div className="rv-trip-history-entry" key={row.order_id}>
                  <div className="rv-history-row">
                    <span>
                      <Identity code={row.code} name={row.name} />
                      <small className="rv-handover-history">
                        {row.items
                          .map((line) => line.qty + " " + line.name)
                          .join(" + ")}
                      </small>
                    </span>
                    <span
                      className={
                        row.outcome === "done"
                          ? "rv-complete"
                          : "rv-status-label"
                      }
                    >
                      {statuses[row.outcome]}
                    </span>
                  </div>
                  <OrderQuantityNote revision={row.revision} />
                </div>
              );
            return (
              <div className="rv-trip-entry" key={row.order_id}>
                <OrderHeading
                  className="rv-trip-order"
                  aria-expanded={active ? undefined : expanded === entryKey}
                  onClick={active ? undefined : () => togglePanel()}
                >
                  <span>
                    <Identity code={row.code} name={row.name} />
                    {!active && productSummary}
                  </span>
                  <span className="rv-trip-right">
                    {o?.prepayment?.settled && (
                      <span className="rv-paid-badge">
                        Lunas · {o.prepayment.method}
                      </span>
                    )}
                    <strong>
                      {money(
                        totals[entryKey] ??
                          row.total ??
                          row.items.reduce((n, l) => n + l.qty * l.price, 0),
                      )}
                    </strong>
                    {row.outcome === "done" && (
                      <span className="rv-complete">Selesai</span>
                    )}
                  </span>
                  {!active && <ChevronDown />}
                </OrderHeading>
                {active && (
                  <div className="rv-trip-detail-line">
                    {productSummary}
                    {active && (
                      <div className="rv-trip-progress">
                        <button
                          type="button"
                          className={
                            "rv-text-button" +
                            (o.items.length ? " rv-trip-record" : "")
                          }
                          aria-expanded={
                            expanded === entryKey &&
                            (o.items.length
                              ? editingOrder !== entryKey
                              : editingOrder === entryKey)
                          }
                          onClick={() => togglePanel(!o.items.length)}
                        >
                          {o.items.length ? (
                            <ReceiptText size={14} />
                          ) : (
                            <SquarePen size={13} />
                          )}{" "}
                          {o.items.length ? "Pembayaran" : "Isi produk"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <OrderQuantityNote
                  revision={active ? o.revision : row.revision}
                />
                {row.outcome === "failed" || row.outcome === "cancel" ? (
                  <span className="rv-note">
                    {statuses[row.outcome]} · {row.reason}
                  </span>
                ) : null}
                {expanded === entryKey &&
                  (active ? (
                    <div
                      className={
                        "rv-inline-panel " +
                        (editingOrder === entryKey || !o.items.length
                          ? "rv-trip-edit-panel"
                          : "rv-trip-payment-panel")
                      }
                    >
                      {editingOrder === entryKey || !o.items.length ? (
                        <OrderQuantityEditor
                          key={o.id + ":edit:" + o.version}
                          order={o}
                          onClose={closePanel}
                        />
                      ) : (
                        <Checkout
                          key={o.id + ":" + o.version}
                          order={o}
                          trip={t}
                          onSaved={closePanel}
                          onTotalChange={(v) =>
                            setTotals((s) => ({ ...s, [entryKey]: v }))
                          }
                        />
                      )}
                    </div>
                  ) : (
                    <div className="rv-inline-receipt">
                      <h3>{statuses[row.outcome]}</h3>
                      {row.items.map((l) => (
                        <div className="rv-line" key={l.modeId}>
                          <span>
                            {l.qty} {l.name}
                          </span>
                          <strong>{money(l.qty * l.price)}</strong>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            );
          })}
        </>
      );
    }
    function render(group, index) {
      const latest = group.trips[0],
        isOpen = open === group.number || (open === null && index === 0),
        multiple = group.trips.length > 1,
        couriers = [...new Set(group.trips.map((t) => t.courier))];
      return (
        <details
          className={"rv-trip " + (!group.active ? "rv-trip-closed" : "")}
          key={group.number}
          open={isOpen}
        >
          <summary
            onClick={(e) => {
              e.preventDefault();
              setOpen(isOpen ? "" : group.number);
            }}
          >
            <span className="rv-trip-titleline">
              <span className="rv-trip-name">
                <strong>
                  Trip {group.number}
                  {!group.active && (
                    <span className="rv-trip-done">Selesai</span>
                  )}
                </strong>
                <span>
                  {multiple
                    ? group.trips.length +
                      " perjalanan · " +
                      group.orderCount +
                      " pelanggan"
                    : (latest.day !== data.today
                        ? dateLabel(latest.day) + " · "
                        : "") +
                      timeLabel(latest.departed_at) +
                      " · " +
                      group.orderCount +
                      " pelanggan"}
                </span>
              </span>
              <span className="rv-trip-metachips">
                <span className="rv-trip-chip">
                  <UserRound />
                  {couriers.length === 1
                    ? couriers[0]
                    : couriers.length + " kurir"}
                </span>
                <PhotoButton
                  id={latest.photo_id}
                  frame="trip"
                  label={
                    "Muatan Trip " +
                    group.number +
                    " · " +
                    dateLabel(latest.day) +
                    " · " +
                    timeLabel(latest.departed_at) +
                    " · " +
                    latest.courier
                  }
                  className="rv-trip-chip rv-trip-photo"
                />
              </span>
              <ChevronDown />
            </span>
          </summary>
          <div className="rv-trip-content">
            {group.trips.map((t) => (
              <section className="rv-trip-session" key={t.id}>
                {multiple && (
                  <div className="rv-trip-session-heading">
                    <span>
                      <strong>
                        {dateLabel(t.day)} · {timeLabel(t.departed_at)}
                      </strong>
                      <span className="rv-note">
                        {t.orders.length} pelanggan
                        {t.closed_at ? " · Selesai" : " · Berjalan"}
                      </span>
                    </span>
                    <span className="rv-trip-metachips">
                      <span className="rv-trip-chip">
                        <UserRound />
                        {t.courier}
                      </span>
                      <PhotoButton
                        id={t.photo_id}
                        frame="trip"
                        label={
                          "Muatan Trip " +
                          t.number +
                          " · " +
                          dateLabel(t.day) +
                          " · " +
                          timeLabel(t.departed_at) +
                          " · " +
                          t.courier
                        }
                        className="rv-trip-chip rv-trip-photo"
                      />
                    </span>
                  </div>
                )}
                {renderRows(t)}
              </section>
            ))}
          </div>
        </details>
      );
    }
    return (
      <>
        <Header
          title="Trip Pengantaran"
          icon={Truck}
          className="rv-trip-page-header"
        >
          {canAccessPage(data.user, "orders") && (
            <button
              className="rv-header-button"
              aria-label="Pilih pesanan"
              onClick={() => go("orders")}
            >
              <Plus />
              <span className="rv-trip-pick-label">Pilih pesanan</span>
            </button>
          )}
        </Header>
        <main className="rv-body">
          <div className="rv-section-heading">
            <h3>Trip hari ini</h3>
            <span className="rv-note">
              {groups
                .flatMap((group) => group.trips)
                .reduce(
                  (n, t) =>
                    n + t.orders.filter((o) => o.outcome === "delivery").length,
                  0,
                )}{" "}
              pesanan belum dicatat
            </span>
          </div>
          {current.map(render)}
          {previous.map((g, i) => render(g, current.length + i + 1))}
          {!groups.length && <Empty>Belum ada trip.</Empty>}
        </main>
      </>
    );
  }
  function Counter() {
    return <NewOrder initialCounter />;
  }
  function DebtPaymentHistory({ onBack }) {
    const { data } = useApp();
    const [period, setPeriod, query] = usePeriod(),
      [search, setSearch] = useState(""),
      [offset, setOffset] = useState(0),
      [history, error] = useResource(
        "/debt-payments?" +
          query +
          "&search=" +
          encodeURIComponent(search) +
          "&offset=" +
          offset,
        { keepPrevious: true },
      );
    return (
      <>
        <header className="rv-header">
          <div className="rv-top">
            <button className="rv-back" onClick={onBack}>
              ‹ Utang pelanggan
            </button>
          </div>
          <div className="rv-heading">
            <h2>
              <History aria-hidden="true" />
              Riwayat pembayaran
            </h2>
          </div>
        </header>
        <main className="rv-body rv-feature">
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder="Cari pelanggan atau akun pembayaran"
          />
          <PeriodFilters
            value={period}
            onChange={(value) => {
              setPeriod(value);
              setOffset(0);
            }}
            today={data.today}
            label="Periode riwayat pembayaran"
          />
          <div className="rv-section-heading">
            <h3>Pembayaran pelanggan</h3>
            <span className="rv-note">{history?.total || 0} pembayaran</span>
          </div>
          {error && (
            <p className="rv-error" role="alert">
              {error}
            </p>
          )}
          {!history && !error && (
            <p className="rv-note" role="status">
              Memuat pembayaran…
            </p>
          )}
          <div className="rv-list">
            {history?.rows.map((row) => (
              <article
                className="rv-payment-record"
                key={row.id}
                style={staffColor(row.actor_id)}
              >
                <div className="rv-payment-record-top">
                  <Identity code={row.customer_code} name={row.customer} />
                  <strong>{money(row.amount)}</strong>
                </div>
                <div className="rv-payment-record-meta">
                  <span
                    className="rv-payment-record-actor"
                    title="Akun pencatat pembayaran"
                  >
                    <UserRound size={13} />
                    {row.actor}
                  </span>
                  <time dateTime={row.created_at}>
                    {dateLabel(row.created_at)} · {timeLabel(row.created_at)}
                  </time>
                  <span>
                    {row.method === "Tunai" ? (
                      <Banknote size={13} />
                    ) : (
                      <ScanLine size={13} />
                    )}
                    {row.method}
                  </span>
                  {row.proof_id && (
                    <PhotoButton id={row.proof_id} label="Bukti QRIS" />
                  )}
                </div>
              </article>
            ))}
          </div>
          {history && !history.rows.length && (
            <Empty>Belum ada pembayaran pada pilihan ini.</Empty>
          )}
          {history && (offset > 0 || history.hasMore) && (
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
                disabled={!history.hasMore}
                onClick={() => setOffset(offset + 30)}
              >
                Berikutnya
              </button>
            </div>
          )}
        </main>
      </>
    );
  }
  function Debts() {
    const { data } = useApp(),
      [selected, setSelected] = useState(null),
      [showPayments, setShowPayments] = useState(false),
      [search, setSearch] = useState("");
    const shown = data.debts.filter((c) =>
      (c.code + " " + c.name).toLowerCase().includes(search.toLowerCase()),
    );
    return showPayments ? (
      <DebtPaymentHistory onBack={() => setShowPayments(false)} />
    ) : selected ? (
      <DebtDetail customer={selected} onBack={() => setSelected(null)} />
    ) : (
      <>
        <Header
          title="Utang pelanggan"
          search={search}
          onSearch={setSearch}
          icon={Wallet}
        />
        <main className="rv-body">
          <div className="rv-section-heading">
            <h3>{shown.length} pelanggan</h3>
            <button
              type="button"
              className="rv-debt-payments-link"
              onClick={() => setShowPayments(true)}
            >
              <History size={14} />
              Riwayat pembayaran
            </button>
          </div>
          <div className="rv-list">
            {shown.map((c) => (
              <button
                className="rv-customer-button"
                key={c.id}
                onClick={() => setSelected(c)}
              >
                <span className="rv-customer-info">
                  <Identity code={c.code} name={c.name} />
                  <span className="rv-note">{c.count} tagihan belum lunas</span>
                </span>
                <span className="rv-customer-money">{money(c.total)}</span>
                <ChevronRight />
              </button>
            ))}
            {!shown.length && <Empty>Belum ada pelanggan berutang.</Empty>}
          </div>
        </main>
      </>
    );
  }
  function DebtDetail({ customer, onBack }) {
    const debtDate = (value) =>
      new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(value));
    const { act, data } = useApp(),
      [statementOpen, setStatementOpen] = useState(false),
      [refresh, setRefresh] = useState(0),
      [rows, error] = useResource(
        "/customers/" + customer.id + "/debts?refresh=" + refresh,
      ),
      [showHistory, setShowHistory] = useState(false),
      [selected, setSelected] = useState([]),
      [paid, setPaid] = useState(""),
      [method, setMethod] = useState(""),
      [proof, setProof] = useState(""),
      [paymentSuccess, setPaymentSuccess] = useState(null),
      [paymentFormVisible, setPaymentFormVisible] = useState(false),
      paymentFormRef = useRef(null);
    useEffect(() => {
      if (!paymentSuccess) return;
      const timer = setTimeout(() => setPaymentSuccess(null), 4000);
      return () => clearTimeout(timer);
    }, [paymentSuccess]);
    const open = (rows || [])
        .filter((r) => r.left > 0)
        .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
      settled = (rows || [])
        .filter((r) => r.left === 0)
        .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)),
      scope = selected.length
        ? open.filter((r) => selected.includes(r.id))
        : open,
      total = open.reduce((n, r) => n + r.left, 0),
      scopeTotal = scope.reduce((n, r) => n + r.left, 0);
    function selectBills(ids) {
      setSelected(ids);
      setPaid(
        ids.length
          ? String(
              open
                .filter((r) => ids.includes(r.id))
                .reduce((sum, r) => sum + r.left, 0),
            )
          : "",
      );
    }
    useEffect(() => {
      const form = paymentFormRef.current;
      if (!form) return;
      const observer = new IntersectionObserver(
        ([entry]) =>
          setPaymentFormVisible(
            entry.isIntersecting && entry.intersectionRatio >= 0.5,
          ),
        { rootMargin: "0px 0px -90px 0px", threshold: 0.5 },
      );
      observer.observe(form);
      return () => observer.disconnect();
    }, [total]);
    const paymentRows = (payments) => (
      <ul className="rv-bill-payments" aria-label="Pembayaran tagihan">
        {payments.map((p) => (
          <li key={p.id}>
            <span>
              Bayar{" "}
              <time dateTime={p.created_at}>{debtDate(p.created_at)}</time>
              <small>{p.method}</small>
            </span>
            <strong>{money(p.amount)}</strong>
          </li>
        ))}
      </ul>
    );
    const renderBill = (r) => (
      <article
        className={"rv-bill " + (!r.left ? "rv-bill-paid" : "")}
        key={r.id}
      >
        <label className="rv-bill-check">
          {r.left ? (
            <input
              type="checkbox"
              aria-label={"Pilih tagihan " + dateLabel(r.recorded_at)}
              checked={selected.includes(r.id)}
              onChange={(e) => {
                selectBills(
                  e.target.checked
                    ? [...selected, r.id]
                    : selected.filter((id) => id !== r.id),
                );
              }}
            />
          ) : (
            <Check />
          )}
        </label>
        <div className="rv-bill-top">
          <span className="rv-bill-date">
            <CalendarDays size={11} />
            <small className="rv-bill-date-label">Utang</small>
            <time dateTime={r.debt_at || r.recorded_at}>
              {debtDate(r.debt_at || r.recorded_at)}
            </time>
          </span>
          <span className="rv-bill-status">
            {!r.left ? (
              <>
                Lunas
                {(r.settled_at || r.payments?.at(-1)?.created_at) && (
                  <time dateTime={r.settled_at || r.payments.at(-1).created_at}>
                    {debtDate(r.settled_at || r.payments.at(-1).created_at)}
                  </time>
                )}
              </>
            ) : r.paid > 0 ? (
              "Sebagian"
            ) : (
              "Belum lunas"
            )}
          </span>
        </div>
        <div className="rv-bill-bottom">
          <ul className="rv-bill-products" aria-label="Rincian tagihan">
            {r.items.map((item, i) => (
              <li className="rv-bill-product" key={i}>
                <span>
                  {item.qty} {item.name}
                  {item.mode && !["Isi ulang", "Beli"].includes(item.mode)
                    ? " (" + item.mode + ")"
                    : ""}{" "}
                  × {money(item.price)}
                </span>
                <span>{money(item.qty * item.price)}</span>
              </li>
            ))}
            {r.shipping > 0 && (
              <li className="rv-bill-product rv-bill-fee">
                <span>Ongkir</span>
                <span>{money(r.shipping)}</span>
              </li>
            )}
            {r.discount > 0 && (
              <li className="rv-bill-product rv-bill-fee">
                <span>Diskon</span>
                <span>−{money(r.discount)}</span>
              </li>
            )}
          </ul>
        </div>
        {r.paid > 0 && r.left > 0 ? (
          <div className="rv-bill-payment-progress">
            {paymentRows(r.payments || [])}
            <div className="rv-bill-remaining">
              <span>Sisa</span>
              <strong>{money(r.left)}</strong>
            </div>
          </div>
        ) : (
          <div className="rv-bill-total">
            {r.left > 0 && <span>Tagihan</span>}
            {!r.left && r.payments?.at(-1)?.method && (
              <span
                className="rv-bill-settlement-method"
                title="Metode pelunasan"
              >
                {r.payments.at(-1).method === "Tunai" ? (
                  <Banknote size={13} />
                ) : (
                  <ScanLine size={13} />
                )}
                {r.payments.at(-1).method}
              </span>
            )}
            <strong className="rv-bill-amount">{money(r.total)}</strong>
          </div>
        )}
        {!r.left && r.payments?.length > 1 && (
          <div className="rv-bill-payment-dates">
            <details>
              <summary>{r.payments.length} pembayaran</summary>
              {paymentRows(r.payments)}
            </details>
          </div>
        )}
      </article>
    );
    return (
      <>
        <header className="rv-header">
          <div className="rv-top">
            <button className="rv-back" onClick={onBack}>
              ‹ Daftar pelanggan
            </button>
          </div>
          <div className="rv-heading">
            <h2 className="rv-debt-customer-title">
              <ContactRound aria-hidden="true" />
              <span className="rv-debt-customer-code">{customer.code}</span>
              <span className="rv-debt-customer-dash">-</span>
              <span>{customer.name}</span>
            </h2>
            <button
              type="button"
              className="rv-header-button rv-statement-open"
              onClick={() => setStatementOpen(true)}
            >
              <ReceiptText size={17} />
              Nota utang
            </button>
          </div>
        </header>
        {statementOpen && (
          <DebtStatement
            customer={customer}
            depotName={data.settings.name}
            useResource={useResource}
            onClose={() => setStatementOpen(false)}
          />
        )}
        <main className="rv-body">
          <div className="rv-card rv-debt-total">
            <span>Total utang</span>
            <strong>{money(total)}</strong>
          </div>
          <div className="rv-stack rv-bill-section">
            <div className="rv-section-heading">
              <h3>Catatan utang</h3>
              <span className="rv-note">{open.length} belum lunas</span>
            </div>
            <div className="rv-list">
              {open.map(renderBill)}
              {rows && !open.length && (
                <Empty>Semua tagihan sudah lunas.</Empty>
              )}
            </div>
            {settled.length > 0 && (
              <div className="rv-debt-history">
                <button
                  type="button"
                  className="rv-debt-history-toggle"
                  aria-expanded={showHistory}
                  aria-controls="rv-settled-debt-history"
                  onClick={() => setShowHistory((shown) => !shown)}
                >
                  <History size={15} aria-hidden="true" />
                  <span>
                    {showHistory
                      ? "Tutup riwayat utang"
                      : "Lihat riwayat utang"}
                  </span>
                  <small>{settled.length} lunas</small>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                <div
                  id="rv-settled-debt-history"
                  className="rv-list"
                  hidden={!showHistory}
                >
                  {showHistory && settled.map(renderBill)}
                </div>
              </div>
            )}
          </div>
          {total > 0 && (
            <AppForm
              ref={paymentFormRef}
              id="rv-debt-payment-form"
              tabIndex={-1}
              className="rv-card rv-stack rv-debt-payment-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await act(async () => {
                  const amount = Number(paid);
                  await api("/customers/" + customer.id + "/payments", {
                    method: "POST",
                    body: {
                      paid: amount,
                      method,
                      proof,
                      ...(selected.length ? { invoiceIds: selected } : {}),
                    },
                  });
                  setPaymentSuccess({ amount });
                  setSelected([]);
                  setPaid("");
                  setRefresh((n) => n + 1);
                }).catch(() => {});
              }}
            >
              <div className="rv-section-heading">
                <h3>
                  <Wallet size={16} aria-hidden="true" />
                  {selected.length
                    ? selected.length + " tagihan pilihan"
                    : "Bayar utang"}
                </h3>
                {selected.length > 0 && (
                  <button
                    type="button"
                    className="rv-text-button"
                    onClick={() => selectBills([])}
                  >
                    Semua utang
                  </button>
                )}
              </div>
              <div className="rv-two">
                <Currency
                  label="Dibayar (Rp)"
                  value={paid}
                  placeholder="0"
                  onChange={setPaid}
                  min="1"
                  max={scopeTotal}
                  required
                />
                <fieldset className="rv-debt-methods">
                  <legend>Metode</legend>
                  <div>
                    {["Tunai", "QRIS"].map((value) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="debt-payment-method"
                          value={value}
                          checked={method === value}
                          onChange={() => setMethod(value)}
                          required
                        />
                        <span>
                          {value === "Tunai" ? (
                            <Banknote size={14} aria-hidden="true" />
                          ) : (
                            <ScanLine size={14} aria-hidden="true" />
                          )}
                          {value}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="rv-balance-line">
                <span>Sisa setelah bayar</span>
                <strong>{money(total - Number(paid || 0))}</strong>
              </div>
              {method === "QRIS" && (
                <Field label="Bukti QRIS (opsional)">
                  <span className="rv-debt-proof-control">
                    <input
                      type="file"
                      aria-label="Pilih bukti QRIS"
                      accept="image/*"
                      onChange={async (e) =>
                        setProof(await imageFile(e.target.files[0]))
                      }
                    />
                    <span className="rv-debt-proof-face">
                      {proof ? (
                        <img src={proof} alt="Bukti QRIS terpilih" />
                      ) : (
                        <Camera size={20} aria-hidden="true" />
                      )}
                      <span>
                        <strong>
                          {proof ? "Ubah bukti QRIS" : "Pilih bukti QRIS"}
                        </strong>
                        <small>
                          {proof ? "Foto siap dilampirkan" : "Gambar atau foto"}
                        </small>
                      </span>
                      <Plus size={16} aria-hidden="true" />
                    </span>
                  </span>
                </Field>
              )}
              <Submit>Simpan pembayaran</Submit>
            </AppForm>
          )}
          {selected.length > 0 && scope.length > 0 && !paymentFormVisible && (
            <div className="rv-debt-pay-shortcut">
              <button
                type="button"
                aria-controls="rv-debt-payment-form"
                onClick={() => {
                  const form = paymentFormRef.current;
                  form?.focus({ preventScroll: true });
                  form?.scrollIntoView({
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "instant"
                      : "smooth",
                    block: "start",
                  });
                }}
              >
                <Wallet size={17} aria-hidden="true" />
                <span>Bayar {scope.length} tagihan</span>
                <strong>{money(scopeTotal)}</strong>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {paymentSuccess && (
            <div
              className="rv-validation-message rv-payment-success"
              role="status"
            >
              <BadgeCheck size={18} aria-hidden="true" />
              <span>
                Pembayaran {money(paymentSuccess.amount)} berhasil disimpan.
              </span>
            </div>
          )}
          <div className="rv-error">{error}</div>
        </main>
      </>
    );
  }
  const ReportExplorer = createReportExplorer(UI);
  function Reports() {
    const { data } = useApp(),
      [period, setPeriod, query] = usePeriod(),
      [report, error] = useResource("/reports?" + query + "&view=summary"),
      [search, setSearch] = useState("");
    const dates = periodDates(data.today, period);
    const sales =
      report?.funds.rows.reduce((sum, fund) => sum + fund.sales, 0) || 0;
    const periodLabel =
      {
        today: "hari ini",
        yesterday: "kemarin",
        week: "minggu ini",
        month: "bulan ini",
        range: "custom",
      }[period.kind] || "";
    return (
      <>
        <Header
          title="Laporan"
          icon={ChartNoAxesCombined}
          className="rv-reports-header"
          filters={
            <PeriodFilters
              value={period}
              onChange={setPeriod}
              today={data.today}
              label="Periode laporan"
            />
          }
        />
        <main className="rv-body rv-feature rv-reports-body">
          <span className="rv-error">{error}</span>
          {report && (
            <>
              <div className="rv-report-equal-summary">
                <section
                  className="rv-card rv-report-metric"
                  aria-label="Penjualan periode"
                >
                  <header>
                    <ChartNoAxesCombined size={15} />
                    <h3>Penjualan {periodLabel}</h3>
                    <span className="rv-report-count">
                      {report.stats.count} transaksi
                    </span>
                  </header>
                  <div className="rv-report-total">
                    <strong className="rv-report-metric-value">
                      {money(sales)}
                    </strong>
                    <p className="rv-report-explanation">
                      Nilai penjualan, termasuk yang masih hutang.
                    </p>
                  </div>
                  <dl className="rv-report-calculation">
                    <div>
                      <dt title="Nilai produk sebelum diskon dan ongkir">
                        <ShoppingBag size={12} aria-hidden="true" /> Penjualan
                      </dt>
                      <dd>
                        {money(
                          sales - report.stats.shipping + report.stats.discount,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Percent size={12} aria-hidden="true" /> Diskon
                      </dt>
                      <dd>
                        {report.stats.discount ? "−" : ""}
                        {money(report.stats.discount)}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <Truck size={12} aria-hidden="true" /> Ongkir
                      </dt>
                      <dd>{money(report.stats.shipping)}</dd>
                    </div>
                  </dl>
                  <footer>
                    <dl className="rv-report-sale-status">
                      <div>
                        <dt>
                          <Check size={12} aria-hidden="true" /> Terbayar
                        </dt>
                        <dd>
                          {money(sales - report.receipts.outstandingSales)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Penjualan periode ini yang belum dibayar sampai akhir periode">
                          <Timer size={12} aria-hidden="true" /> Hutang
                        </dt>
                        <dd>{money(report.receipts.outstandingSales)}</dd>
                      </div>
                    </dl>
                    {!!report.receipts.receivedBefore && (
                      <p className="rv-report-explanation">
                        Termasuk {money(report.receipts.receivedBefore)} dibayar
                        sebelum periode ini.
                      </p>
                    )}
                  </footer>
                </section>
                <section
                  className="rv-card rv-report-metric"
                  aria-label="Uang masuk periode"
                >
                  <header>
                    <Banknote size={15} />
                    <h3>Uang masuk {periodLabel}</h3>
                  </header>
                  <div className="rv-report-total">
                    <strong className="rv-report-metric-value">
                      {money(report.receipts.total)}
                    </strong>
                    <p className="rv-report-explanation">
                      Uang yang benar-benar diterima.
                    </p>
                  </div>
                  <dl className="rv-report-sources">
                    <div>
                      <dt title="Pembayaran penjualan yang selesai pada periode pilihan">
                        <ShoppingBag size={12} aria-hidden="true" /> Dari
                        penjualan periode ini
                      </dt>
                      <dd>{money(report.receipts.sales)}</dd>
                    </div>
                    <div>
                      <dt title="Pembayaran tagihan yang berasal dari sebelum periode pilihan">
                        <History size={12} aria-hidden="true" /> Pelunasan
                        hutang lama
                      </dt>
                      <dd>{money(report.receipts.oldDebt)}</dd>
                    </div>
                  </dl>
                  {!!(
                    report.receipts.advances + report.receipts.unallocated
                  ) && (
                    <details className="rv-report-other-receipts">
                      <summary>
                        <span>Penerimaan lain</span>
                        <strong>
                          {money(
                            report.receipts.advances +
                              report.receipts.unallocated,
                          )}
                        </strong>
                      </summary>
                      <dl>
                        {!!report.receipts.advances && (
                          <div>
                            <dt>Pesanan belum selesai pada periode ini</dt>
                            <dd>{money(report.receipts.advances)}</dd>
                          </div>
                        )}
                        {!!report.receipts.unallocated && (
                          <div>
                            <dt>Belum dialokasikan</dt>
                            <dd>{money(report.receipts.unallocated)}</dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  )}
                  <footer>
                    <dl className="rv-report-receipt-methods">
                      <div>
                        <dt>
                          <Banknote size={13} aria-hidden="true" /> Tunai
                        </dt>
                        <dd>{money(report.stats.cash)}</dd>
                      </div>
                      <div>
                        <dt>
                          <ScanLine size={13} aria-hidden="true" /> QRIS
                        </dt>
                        <dd>{money(report.stats.qris)}</dd>
                      </div>
                    </dl>
                  </footer>
                </section>
              </div>
              <div className="rv-card rv-line">
                <span>Saldo utang saat ini</span>
                <strong>{money(report.stats.debt)}</strong>
              </div>
              <FundSummary funds={report.funds} periodLabel={periodLabel} />
              <CashHolders
                rows={report.cashHolders}
                cash={report.stats.cash}
                qris={report.stats.qris}
              />
              <SearchField value={search} onChange={setSearch} />
              <ReportExplorer
                query={query}
                search={search}
                multiDay={dates.from !== dates.to}
                day={dates.from}
              />
            </>
          )}
        </main>
      </>
    );
  }
  function Other() {
    const { data, setError } = useApp();
    const menus = menuItemsFor(data.user);
    return (
      <>
        <Header title="Lainnya" icon={Grid2X2} />
        <main className="rv-body rv-more-body">
          <div className="rv-account-strip">
            <span className="rv-account-avatar">{data.user.name[0]}</span>
            <span>
              <strong>{data.settings.name}</strong>
              <span>
                {data.user.owner ? "Owner · Semua akses" : data.user.name}
              </span>
            </span>
            <BadgeCheck />
          </div>
          {[menus.slice(0, 3), menus.slice(3)].map((group, groupIndex) => (
            <div key={groupIndex} className="rv-menu-group">
              {group.map(([key, title, note, Icon], i) => (
                <button
                  className="rv-menu-row"
                  key={key}
                  onClick={() => go(key)}
                >
                  <span
                    className={
                      "rv-menu-icon " +
                      (key === "counter" ||
                      key === "products" ||
                      key === "display"
                        ? "rv-peach"
                        : ["attendance", "staff"].includes(key)
                          ? "rv-mint"
                          : "")
                    }
                  >
                    <Icon />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <span>{note}</span>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          ))}
          <button
            className="rv-text-button"
            onClick={async () => {
              try {
                await api("/logout", { method: "POST" });
                window.location.reload();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <LogOut />
            Keluar akun
          </button>
        </main>
      </>
    );
  }
  return {
    home: Home,
    orders: Orders,
    neworder: NewOrder,
    departure: Departure,
    trips: Trips,
    debt: Debts,
    reports: Reports,
    expenses: createCashPage(UI),
    other: Other,
    counter: Counter,
  };
}
