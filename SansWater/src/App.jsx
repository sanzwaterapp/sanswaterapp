import AppForm from "./AppForm.jsx";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Droplets,
  House,
  ClipboardList,
  Truck,
  Wallet,
  Grid2X2,
  Plus,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Camera,
  Search,
  Check,
  UserRound,
  Package,
  Banknote,
  Timer,
  ScanLine,
  Percent,
  Users,
  ChartNoAxesCombined,
  Settings,
  History,
  Monitor,
  LogOut,
  X,
  Minus,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  ContactRound,
  SquarePen,
  CalendarDays,
  MapPin,
  Phone,
  RotateCw,
  Trash2,
  Palette,
  Type,
  Rows3,
} from "lucide-react";
import DurationChip from "./DurationChip.jsx";
import DurationCategoryEditor from "./DurationCategoryEditor.jsx";
import CategoryEditor from "./category-editor.jsx";
import { readPreferences, normalizePreferences } from "./app-preferences.js";
import { canAccessPage } from "./page-access.js";
import {
  api,
  mutationVersion,
  money,
  dateLabel,
  timeLabel,
  can,
  statuses,
  filters,
  filterLabels,
  duration,
  sortDisplayOrders,
} from "./api.js";
import { createApprovedPages, OrderStatusFilters } from "./approved-pages.jsx";
import { CameraCapture } from "./DepartureCamera.jsx";
import BrandMark from "./BrandMark.jsx";
import { periodDates } from "./period-range.js";
import PeriodFilters from "./period-filters.jsx";
import { AppBar } from "./app-menu.jsx";
import CashGroupEditor from "./cash-group-editor.jsx";
import SearchInput from "./SearchInput.jsx";
import { staffColor, stockMovementNote } from "./stock-history-display.js";
import { formatLiters } from "./water-volume.js";
import { createWaterControl } from "./water-control.jsx";
import { createWaterReports } from "./water-reports.jsx";
import { createAccountMenu } from "./account-menu.jsx";
import { connectLiveUpdates } from "./live-updates.js";
import { coversVersion } from "./sync-version.js";

const Context = createContext();
const useApp = () => useContext(Context);
const navigate = (page) => {
  window.location.hash = page;
};
function Identity({ code, name }) {
  return (
    <span className="rv-identity">
      <b>{code || "Umum"}</b> <span className="rv-dash">-</span> {name}
    </span>
  );
}
function Empty({
  children = "Belum ada catatan.",
  icon: Icon = ClipboardList,
}) {
  return (
    <div className="empty">
      <Icon size={26} />
      <p>{children}</p>
    </div>
  );
}
function Field({ label, children, ...props }) {
  return (
    <label className="rv-field">
      {label}
      {children || <input {...props} />}
    </label>
  );
}
function Currency({ label, value, onChange, ...props }) {
  return (
    <Field label={label}>
      <input
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </Field>
  );
}
function Submit({ children = "Simpan", ...props }) {
  const { busy } = useApp();
  return (
    <button
      className="rv-primary"
      type="submit"
      {...props}
      disabled={busy || props.disabled}
    >
      {busy ? "Menyimpan…" : children}
      <Check size={16} />
    </button>
  );
}
function Back({ to = "other", children }) {
  const { openMenu } = useApp();
  return (
    <button
      className="rv-back"
      type="button"
      onClick={() => (to === "other" ? openMenu() : navigate(to))}
    >
      <ArrowLeft size={16} />
      {children ||
        { orders: "Pesanan", other: "Menu", settings: "Pengaturan" }[to] ||
        "Kembali"}
    </button>
  );
}
function PhotoButton({
  id,
  label = "Lihat foto",
  className = "rv-attendance-photo",
}) {
  const { setPhoto } = useApp();
  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPhoto({ id, label });
      }}
    >
      <Camera size={16} />
    </button>
  );
}
function Header({
  title,
  icon: Icon,
  children,
  back,
  search,
  onSearch,
  filters,
  greeting,
  className = "",
}) {
  return (
    <header className={"rv-header " + className}>
      {back && (
        <div className="rv-top">
          <Back to={back} />
        </div>
      )}
      <div className="rv-heading">
        <h2>
          {Icon && <Icon aria-hidden="true" />}
          {title}
        </h2>
        {children}
      </div>
      {greeting && (
        <div className="rv-home-greeting">
          Selamat{" "}
          {new Date().getHours() < 11
            ? "pagi"
            : new Date().getHours() < 15
              ? "siang"
              : new Date().getHours() < 18
                ? "sore"
                : "malam"}
          , semoga lancar hari ini.
        </div>
      )}
      {onSearch && (
        <label className="rv-search">
          <Search />
          <SearchInput
            aria-label="Cari kode atau nama pelanggan"
            placeholder="Cari nama atau kode pelanggan"
            value={search}
            onChange={onSearch}
          />
        </label>
      )}
      {filters}
    </header>
  );
}
function PhotoViewer() {
  const { photo, setPhoto } = useApp(),
    ref = useRef();
  useEffect(() => {
    if (photo) ref.current?.showModal();
  }, [photo]);
  const image = photo && (
    <img
      id="rv-photo-image"
      src={"/api/photos/" + photo.id}
      alt={photo.label}
    />
  );
  return (
    <dialog
      className="rv-photo-dialog rv-framed-photo-dialog"
      aria-label={photo?.label || "Foto"}
      ref={ref}
      onClose={() => setPhoto(null)}
    >
      <div className="rv-photo-dialog-top">
        <span>
          <strong>{photo?.label}</strong>
        </span>
        <button
          className="rv-icon-button"
          onClick={() => ref.current.close()}
          aria-label="Tutup foto"
        >
          <X />
        </button>
      </div>
      <div className="rv-saved-photo-frame">{image}</div>
    </dialog>
  );
}
function Auth({ session, onLogin }) {
  const setup = session.needsSetup,
    supabase = session.authProvider === "supabase",
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(setup ? "/setup" : "/login", { method: "POST", body: fields });
      await onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth rv-auth-screen">
      <div className="auth-brand">
        <BrandMark />
      </div>
      <span className="eyebrow sanz-wordmark">Sanz Water</span>
      <h1>{setup ? "Selamat datang." : "Selamat bekerja."}</h1>
      <p>
        {setup
          ? "Buat akun owner untuk memulai pencatatan depot."
          : "Masuk untuk melanjutkan pekerjaan hari ini."}
      </p>
      <AppForm
        className="rv-card rv-stack rv-auth-form"
        onSubmit={submit}
        aria-label={setup ? "Buat akun owner" : "Masuk ke Sanz Water"}
        aria-busy={busy}
        onChange={() => error && setError("")}
      >
        {setup && (
          <>
            <Field
              label="Nama depot"
              name="depotName"
              required
              autoComplete="organization"
            />
            <Field
              label="Nama owner"
              name="name"
              required
              autoComplete="name"
            />
          </>
        )}
        <Field
          label={supabase ? "Email" : "Username"}
          name={supabase ? "email" : "username"}
          type={supabase ? "email" : "text"}
          autoComplete="username"
          required
          minLength={supabase ? undefined : 3}
        />
        <Field
          label="Kata sandi"
          name="password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          required
        />
        {error && (
          <div className="rv-auth-alert" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>
              <strong>
                {setup ? "Akun belum dibuat" : "Belum berhasil masuk"}
              </strong>
              <span>{error}</span>
            </span>
          </div>
        )}
        <button className="rv-primary" disabled={busy}>
          {busy ? "Memproses…" : setup ? "Mulai gunakan aplikasi" : "Masuk"}
          <ChevronRight size={17} />
        </button>
      </AppForm>
      <span className="auth-foot">
        Satu alur yang lebih mudah untuk pekerjaan depot.
      </span>
    </main>
  );
}
export function App() {
  const [session, setSession] = useState(null),
    [data, setData] = useState(null),
    [page, setPage] = useState(
      window.location.hash.slice(1).split("?")[0] || "home",
    ),
    [routeKey, setRouteKey] = useState(window.location.hash),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [photo, setPhoto] = useState(null),
    [menuOpen, setMenuOpen] = useState(false),
    [accountOpen, setAccountOpen] = useState(false),
    [syncStatus, setSyncStatus] = useState("connected"),
    [tick, setTick] = useState(Date.now()),
    [preferences, setPreferences] = useState(readPreferences);
  const sessionEpoch = useRef(0);
  const accountRef = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const refreshFlight = useRef(null);
  function savePreferences(next) {
    const value = normalizePreferences(next);
    setPreferences(value);
    try {
      localStorage.setItem("depot.preferences", JSON.stringify(value));
    } catch {
      /* The current tab still applies the preference. */
    }
  }
  const refresh = async (minimumVersion, retried = false) => {
    const epoch = sessionEpoch.current;
    if (refreshFlight.current?.epoch === epoch) {
      const value = await refreshFlight.current.promise;
      if (
        !retried &&
        epoch === sessionEpoch.current &&
        minimumVersion &&
        !coversVersion(value.syncVersion, minimumVersion)
      )
        return refresh(minimumVersion, true);
      return value;
    }
    const pending = { epoch, promise: null };
    pending.promise = api("/state")
      .then((value) => {
        if (epoch === sessionEpoch.current) {
          dataRef.current = value;
          setData(value);
        }
        return value;
      })
      .finally(() => {
        if (refreshFlight.current === pending) refreshFlight.current = null;
      });
    refreshFlight.current = pending;
    return pending.promise;
  };
  const load = async () => {
    const epoch = ++sessionEpoch.current;
    const value = await api("/session");
    if (epoch !== sessionEpoch.current) return;
    setSession(value);
    if (value.user) await refresh();
    else setData(null);
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const handler = () => {
      setPage(window.location.hash.slice(1).split("?")[0] || "home");
      setRouteKey(window.location.hash);
      setError("");
      setMenuOpen(false);
      setAccountOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    const expired = () => {
      sessionEpoch.current++;
      setData(null);
      setSession((current) => (current ? { ...current, user: null } : current));
      setPhoto(null);
      setMenuOpen(false);
      setAccountOpen(false);
    };
    window.addEventListener("depot:unauthorized", expired);
    return () => window.removeEventListener("depot:unauthorized", expired);
  }, []);
  useEffect(() => {
    if (page === "history") window.location.replace("#reports");
  }, [page]);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => {
      setTick(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, [!!data]);
  useEffect(() => {
    if (!data) return;
    return connectLiveUpdates({
      getState: () => dataRef.current,
      refresh: (version) => refresh(version),
      onStatus: setSyncStatus,
      onUnauthorized: () =>
        window.dispatchEvent(new Event("depot:unauthorized")),
    });
  }, [!!data]);
  async function act(work) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await work();
      try {
        await refresh(mutationVersion());
      } catch {
        setError(
          "Data sudah tersimpan, tetapi tampilan belum diperbarui. Muat ulang saat koneksi tersedia.",
        );
      }
      return result;
    } catch (err) {
      setError(err.message);
      if (err.status === 401) {
        setData(null);
        setSession((s) => ({ ...s, user: null }));
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }
  const context = {
    data,
    refresh,
    act,
    busy,
    error,
    setError,
    photo,
    setPhoto,
    tick,
    openMenu: () => {
      setAccountOpen(false);
      setMenuOpen(true);
    },
    preferences,
    savePreferences,
  };
  if (!session || (session.user && !data))
    return (
      <main className="auth rv-app-loading" aria-label="Memuat aplikasi">
        <div className="rv-loading-logo">
          <BrandMark />
        </div>
        <h1>Sanz Water</h1>
        <p role="status">Memuat…</p>
        <p className="rv-error">{error}</p>
        {error && (
          <button onClick={() => load().catch((e) => setError(e.message))}>
            Coba kembali
          </button>
        )}
      </main>
    );
  if (!session.user || !data) return <Auth session={session} onLogin={load} />;
  const pages = {
    customers: Customers,
    products: Products,
    productedit: ProductEdit,
    stockhistory: StockHistory,
    watercontrol: can(data.user, "waterControl") ? WaterControl : WaterReports,
    waterreports: WaterReports,
    attendance: Attendance,
    history: approvedPages.reports,
    staff: Staff,
    settings: SettingsPage,
    display: Display,
    corrections: Corrections,
    audit: Audit,
    ...approvedPages,
  };
  const Page = pages[page] || approvedPages.home,
    rootPage = ["home", "orders", "trips", "debt", "expenses"].includes(page)
      ? page
      : ["neworder", "counter"].includes(page)
        ? "orders"
        : "other";
  const allowed = canAccessPage(data.user, page);
  const isDeparture = page === "departure" && allowed;
  async function logout() {
    try {
      sessionEpoch.current++;
      await api("/logout", { method: "POST" });
      window.location.reload();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Context.Provider value={context}>
      <div
        id="depot-order-payment-review"
        data-color="light"
        data-text={preferences.text}
        data-density={preferences.density}
      >
        <div
          className={
            "app rv-phone " +
            (page === "display"
              ? "app-display"
              : isDeparture
                ? "rv-departure-screen"
                : "")
          }
        >
          {!isDeparture && (
            <AppBar
              data={data}
              page={page}
              open={menuOpen}
              onOpen={() => {
                setAccountOpen(false);
                setMenuOpen(true);
              }}
              onClose={() => setMenuOpen(false)}
              onNavigate={navigate}
              onLogout={logout}
              accountOpen={accountOpen}
              accountRef={accountRef}
              onAccount={() => {
                setMenuOpen(false);
                setAccountOpen((open) => !open);
              }}
            />
          )}
          {accountOpen && (
            <AccountMenu
              anchorRef={accountRef}
              onClose={() => setAccountOpen(false)}
              onLogout={logout}
            />
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button
                aria-label="Tutup pemberitahuan"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {syncStatus !== "connected" && (
            <div className="rv-sync-status" role="status">
              {syncStatus === "offline"
                ? "Koneksi pembaruan terputus. Data terakhir tetap ditampilkan; penyimpanan memerlukan koneksi."
                : "Menyambungkan kembali pembaruan…"}
            </div>
          )}
          {allowed ? (
            <Page key={routeKey} />
          ) : (
            <>
              <Header title="Akses akun" icon={ShieldCheck} back="other" />
              <main className="rv-body">
                <Empty icon={ShieldCheck}>
                  Fitur ini belum tersedia untuk akunmu.
                </Empty>
              </main>
            </>
          )}
          {page !== "display" && !isDeparture && (
            <nav className="rv-nav" aria-label="Menu utama">
              {[
                ["home", "Beranda", House],
                ["orders", "Pesanan", ClipboardList],
                ["trips", "Trip", Truck],
                ["debt", "Hutang", Timer],
                ["expenses", "Pengeluaran", Wallet],
              ]
                .filter(([p]) => canAccessPage(data.user, p))
                .map(([p, label, Icon]) => (
                  <button
                    key={p}
                    className={
                      rootPage === p ? "rv-nav-current" : "rv-nav-item"
                    }
                    aria-current={rootPage === p ? "page" : undefined}
                    onClick={() => navigate(p)}
                  >
                    <Icon size={19} />
                    <span>{label}</span>
                  </button>
                ))}
            </nav>
          )}
          <PhotoViewer />
        </div>
      </div>
    </Context.Provider>
  );
}
function useResource(
  path,
  { keepPrevious = false, resetKey, live = true } = {},
) {
  const { data } = useApp();
  const version = live ? data.syncVersion : null;
  const [value, setValue] = useState(null),
    [error, setError] = useState("");
  const previousResetKey = useRef(resetKey);
  const previousPath = useRef(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (
      (!keepPrevious && previousPath.current !== path) ||
      previousResetKey.current !== resetKey
    )
      setValue(null);
    previousPath.current = path;
    previousResetKey.current = resetKey;
    api(path, { signal: controller.signal })
      .then((v) => {
        if (active) {
          setValue(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, keepPrevious, resetKey, version]);
  return [value, error, setValue];
}
function Period({
  value,
  onChange,
  heading,
  label = "Filter periode pembelian",
  allLabel = "Semua transaksi",
}) {
  const select = (
    <select
      aria-label={label}
      value={value.kind}
      onChange={(e) => onChange({ ...value, kind: e.target.value })}
    >
      <option value="all">{allLabel}</option>
      <option value="today">Hari ini</option>
      <option value="yesterday">Kemarin</option>
      <option value="week">Minggu ini</option>
      <option value="month">Bulan ini</option>
      <option value="range">Rentang tanggal</option>
    </select>
  );
  return (
    <div className="period-controls">
      {heading ? (
        <div className="rv-section-heading">
          <h3>{heading}</h3>
          {select}
        </div>
      ) : (
        <label className="rv-customer-period-picker">
          <CalendarDays size={15} />
          {select}
          <ChevronDown size={14} />
        </label>
      )}
      {value.kind === "range" && (
        <div className="rv-two">
          <Field
            label="Dari"
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <Field
            label="Sampai"
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
function usePeriod(initial) {
  const { data, preferences } = useApp();
  initial ||= preferences?.period || "today";
  const [value, setValue] = useState({
    kind: initial,
    from:
      initial === "range"
        ? new Date(
            new Date(data.today + "T00:00:00+07:00").getTime() -
              90 * 86400000 +
              25200000,
          )
            .toISOString()
            .slice(0, 10)
        : data.today.slice(0, 7) + "-01",
    to: data.today,
  });
  const { from, to } = periodDates(data.today, value);
  return [
    value,
    setValue,
    value.kind === "all"
      ? "period=all"
      : `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ];
}
function SearchField({
  value,
  onChange,
  placeholder = "Cari kode atau nama pelanggan",
}) {
  return (
    <label className="rv-soft-search">
      <Search size={16} />
      <SearchInput
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}
function CustomerPicker({
  value,
  onChange,
  guestName,
  onGuestChange,
  optional = false,
}) {
  const { data } = useApp(),
    [query, setQuery] = useState(guestName || ""),
    [focused, setFocused] = useState(false);
  const selected = data.customers.find((c) => c.id === value),
    suggestions = data.customers
      .filter((c) =>
        (c.code + " " + c.name).toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, 5);
  return (
    <div
      className="rv-stack rv-customer-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <Field>
        <input
          aria-label="Pelanggan"
          placeholder={
            optional
              ? "Nama pembeli (opsional), atau cari pelanggan"
              : "Kode, nama, atau nama pembeli umum"
          }
          required={!optional}
          value={selected ? selected.code + " — " + selected.name : query}
          onChange={(e) => {
            onChange("");
            setQuery(e.target.value);
            onGuestChange(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          autoComplete="off"
        />
      </Field>
      {!selected && query && focused && suggestions.length > 0 && (
        <div className="rv-customer-suggestions">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.id);
                setQuery("");
                onGuestChange("");
                setFocused(false);
              }}
            >
              <span
                className="rv-customer-option-name"
                title={c.code + " — " + c.name}
              >
                <b>{c.code}</b> {c.name}
              </span>
              <span className="rv-customer-option-phone">
                {c.whatsapp || "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function PaymentFields({ value, onChange, total, registered }) {
  const [extra, setExtra] = useState(false),
    set = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div className="rv-stack">
      <div className="rv-two">
        <Field label="Metode">
          <select
            value={value.method}
            onChange={(e) => {
              set("method", e.target.value);
              if (e.target.value === "")
                onChange({ ...value, method: "", paid: "0" });
            }}
          >
            <option value="">Belum bayar</option>
            <option>Tunai</option>
            <option>QRIS</option>
          </select>
        </Field>
        <Currency
          label="Dibayar (Rp)"
          value={value.paid}
          onChange={(v) => set("paid", v)}
          max={total}
          required
        />
      </div>
      <div className="balance-line">
        <span>Sisa utang</span>
        <strong>{money(total - Number(value.paid))}</strong>
      </div>
      {!registered && Number(value.paid) !== total && (
        <small className="rv-error">Pembeli umum harus membayar lunas.</small>
      )}
      {value.method === "Tunai" && (
        <>
          <button
            className="rv-text-button"
            type="button"
            onClick={() => setExtra(!extra)}
          >
            Hitung kembalian
            <ChevronDown size={13} />
          </button>
          {extra && (
            <>
              <Currency
                label="Uang diterima"
                value={value.tender ?? ""}
                onChange={(v) => set("tender", v)}
              />
              <div className="rv-line">
                <span>Kembalian</span>
                <strong>
                  {money(
                    Math.max(0, Number(value.tender) - Number(value.paid)),
                  )}
                </strong>
              </div>
            </>
          )}
        </>
      )}
      {value.method === "QRIS" && (
        <CameraCapture
          label="Bukti QRIS (opsional)"
          photo={value.proof}
          onChange={(photo) => set("proof", photo)}
          allowFile
        />
      )}
      {value.error && <small className="rv-error">{value.error}</small>}
    </div>
  );
}
function PurchaseItems({ row }) {
  return (
    <div className="rv-purchase-detail">
      <ul className="rv-purchase-bullets">
        {row.items.map((l, i) => (
          <li key={i}>
            <div
              className="rv-purchase-item"
              title={`${l.qty} × ${l.name} · ${l.mode} · ${money(l.price)}/unit`}
              aria-label={`${l.qty} × ${l.name}, ${l.mode}, ${money(l.price)} per unit, total ${money(l.qty * l.price)}`}
            >
              <span>
                <strong>
                  {l.qty} × {l.name}
                </strong>
                <small>{l.mode}</small>
              </span>
              <strong>{money(l.qty * l.price)}</strong>
            </div>
          </li>
        ))}
        {row.shipping > 0 && (
          <li className="rv-purchase-extra">
            <div className="rv-purchase-item">
              <span>Ongkir</span>
              <strong>{money(row.shipping)}</strong>
            </div>
          </li>
        )}
        {row.discount > 0 && (
          <li className="rv-purchase-extra">
            <div className="rv-purchase-item">
              <span>Diskon</span>
              <strong>−{money(row.discount)}</strong>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
function Customers() {
  const { data, act } = useApp(),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState(null),
    [form, setForm] = useState(null),
    [groupForm, setGroupForm] = useState(null),
    [period, setPeriod, query] = usePeriod("all"),
    [purchasePage, setPurchasePage] = useState(0),
    [customerPurchases] = useResource(
      can(data.user, "reports") ? "/customer-purchases?period=all" : "/session",
    ),
    [insight, error] = useResource(
      selected && can(data.user, "reports")
        ? "/customers/" +
            selected.id +
            "/purchases?" +
            query +
            "&offset=" +
            purchasePage * 20
        : "/session",
    ),
    [codeHint, setCodeHint] = useState("");
  const prefixOf = (code) => code.match(/^[A-Z]+/i)?.[0].toUpperCase() || "#",
    groupOf = (customer) => customer.group_prefix || prefixOf(customer.code),
    groupNames = new Map(
      (data.customerGroups || []).map((g) => [g.prefix, g.name]),
    );
  for (const c of data.customers) {
    const prefix = groupOf(c);
    if (!groupNames.has(prefix)) groupNames.set(prefix, "Kelompok " + prefix);
  }
  const shown = data.customers.filter((c) =>
      (c.code + " " + c.name + " " + groupNames.get(groupOf(c)))
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
    groups = new Map();
  for (const [prefix, name] of groupNames) {
    if (
      !search ||
      (prefix + " " + name).toLowerCase().includes(search.toLowerCase()) ||
      shown.some((c) => groupOf(c) === prefix)
    )
      groups.set(prefix, { name, people: [] });
  }
  for (const c of shown) {
    groups.get(groupOf(c)).people.push(c);
  }
  function newCustomer(
    prefix = group || groupNames.keys().next().value || "A",
  ) {
    setPhotoError("");
    setForm({
      code: prefix === "#" ? "A" : prefix,
      groupPrefix: prefix === "#" ? "A" : prefix,
      name: "",
      whatsapp: "",
      location: "",
    });
  }
  async function saveGroup(e) {
    e.preventDefault();
    await act(async () => {
      await api(
        groupForm.edit
          ? "/customer-groups/" + encodeURIComponent(groupForm.prefix)
          : "/customer-groups",
        { method: groupForm.edit ? "PATCH" : "POST", body: groupForm },
      );
      setGroup(groupForm.prefix.toUpperCase());
      setGroupForm(null);
    }).catch(() => {});
  }
  async function deleteGroup(e) {
    e.preventDefault();
    await act(async () => {
      const result = await api(
        "/customer-groups/" + encodeURIComponent(groupForm.prefix),
        {
          method: "DELETE",
          body: { moveTo: groupForm.moveTo },
        },
      );
      setGroup(result.movedTo || "");
      setSelected(null);
      setGroupForm(null);
    }).catch(() => {});
  }
  const groupMemberCount = groupForm
    ? data.customers.filter((c) => groupOf(c) === groupForm.prefix).length
    : 0;
  useEffect(() => {
    const code = form?.code,
      prefix = code?.match(/^[A-Z]+/i)?.[0];
    if (!prefix || form?.id) {
      setCodeHint("");
      return;
    }
    let live = true;
    api("/customer-code?prefix=" + prefix)
      .then((v) => {
        if (live) {
          setCodeHint(v.suggested);
          setForm((current) =>
            current && !current.id && current.code === prefix
              ? { ...current, code: v.suggested }
              : current,
          );
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [form?.code, form?.id]);
  async function save(e) {
    e.preventDefault();
    await act(async () => {
      await api(form.id ? "/customers/" + form.id : "/customers", {
        method: form.id ? "PATCH" : "POST",
        body: form,
      });
      setGroup(form.groupPrefix || groupOf(form));
      setForm(null);
    }).catch(() => {});
  }
  return (
    <>
      <Header title="Pelanggan" icon={ContactRound}>
        {can(data.user, "customers") && (
          <button className="rv-header-button" onClick={() => newCustomer()}>
            <Plus size={16} />
            Pelanggan
          </button>
        )}
      </Header>
      <main className="rv-body rv-feature rv-customers-body">
        {form ? (
          <AppForm
            className="rv-card rv-stack rv-customer-form"
            onSubmit={save}
          >
            <div className="rv-section-heading">
              <h3>
                <span className="rv-customer-form-icon">
                  <ContactRound size={19} />
                </span>
                {form.id ? "Ubah pelanggan" : "Pelanggan baru"}
              </h3>
              <button
                className="rv-icon-button"
                type="button"
                aria-label="Tutup form"
                onClick={() => setForm(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="rv-customer-code-row">
              <Field label="Kelompok">
                <select
                  aria-label="Kelompok pelanggan"
                  value={form.groupPrefix || groupOf(form)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      groupPrefix: e.target.value,
                      ...(!form.id ? { code: e.target.value } : {}),
                    })
                  }
                >
                  {[
                    ...new Map([
                      ...groupNames,
                      [
                        form.groupPrefix || groupOf(form),
                        groupNames.get(form.groupPrefix || groupOf(form)) ||
                          "Kelompok " + (form.groupPrefix || groupOf(form)),
                      ],
                    ]),
                  ]
                    .filter(([prefix]) => prefix !== "#")
                    .map(([prefix, name]) => (
                      <option value={prefix} key={prefix}>
                        {name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Kode pelanggan"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                required
                pattern="[A-Z]+[0-9]+"
                maxLength={30}
              />
            </div>
            {data.customers.some(
              (c) =>
                c.code.toUpperCase() === form.code.toUpperCase() &&
                c.id !== form.id,
            ) ? (
              <small className="rv-error">Kode ini sudah digunakan.</small>
            ) : (
              codeHint &&
              !form.id && (
                <button
                  type="button"
                  className="rv-customer-code-hint"
                  onClick={() => setForm({ ...form, code: codeHint })}
                >
                  {form.code !== codeHint
                    ? "Gunakan " + codeHint
                    : "Kode tersedia"}
                </button>
              )
            )}
            <Field
              label="Nama pelanggan"
              placeholder="Nama lengkap pelanggan"
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Field
              label="WhatsApp"
              type="tel"
              placeholder="08xxxxxxxxxx"
              autoComplete="tel"
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              required
            />
            <details className="rv-customer-optional">
              <summary>
                <MapPin size={15} />
                Lokasi & foto rumah<span>Opsional</span>
                <ChevronDown size={14} />
              </summary>
              <div className="rv-stack">
                <Field
                  label="Titik koordinat (opsional)"
                  placeholder="Lintang, bujur"
                  value={form.location}
                  onChange={(e) =>
                    setForm({ ...form, location: e.target.value })
                  }
                />
                <CameraCapture
                  label="Foto rumah (opsional)"
                  photo={form.photo}
                  onChange={(photo) => setForm((current) => current ? { ...current, photo } : null)}
                  allowFile
                />
              </div>
            </details>
            <Submit>Simpan pelanggan</Submit>
          </AppForm>
        ) : (
          <>
            <div className="rv-customer-overview">
              <span className="rv-customer-overview-icon">
                <Users size={24} />
              </span>
              <span>
                <strong>{data.customers.length} pelanggan</strong>
                <small>{groupNames.size} kelompok terdaftar</small>
              </span>
              <ContactRound size={52} aria-hidden="true" />
            </div>
            <SearchField value={search} onChange={setSearch} />
            <div className="rv-section-heading rv-customer-groups-heading">
              <h3>Kelompok pelanggan</h3>
              {can(data.user, "customers") && (
                <button
                  type="button"
                  onClick={() =>
                    setGroupForm(groupForm ? null : { prefix: "", name: "" })
                  }
                >
                  <Plus size={14} />
                  Kelompok
                </button>
              )}
            </div>
            {groupForm && (
              <AppForm
                className="rv-card rv-stack rv-customer-group-form"
                onSubmit={groupForm.deleting ? deleteGroup : saveGroup}
              >
                <div className="rv-section-heading">
                  <h3>
                    {groupForm.deleting
                      ? "Hapus " + groupForm.name
                      : groupForm.edit
                        ? "Ubah nama kelompok"
                        : "Kelompok baru"}
                  </h3>
                  <button
                    type="button"
                    className="rv-icon-button"
                    aria-label="Tutup form kelompok"
                    onClick={() => setGroupForm(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {groupForm.deleting ? (
                  <>
                    {groupMemberCount > 0 ? (
                      <Field
                        label={
                          "Pindahkan " + groupMemberCount + " pelanggan ke"
                        }
                      >
                        <select
                          required
                          value={groupForm.moveTo || ""}
                          onChange={(e) =>
                            setGroupForm({
                              ...groupForm,
                              moveTo: e.target.value,
                            })
                          }
                        >
                          <option value="">Pilih kelompok tujuan</option>
                          {[...groupNames]
                            .filter(
                              ([prefix]) =>
                                prefix !== groupForm.prefix && prefix !== "#",
                            )
                            .map(([prefix, name]) => (
                              <option value={prefix} key={prefix}>
                                {name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    ) : null}
                    <p className="rv-group-delete-note">
                      {groupMemberCount
                        ? groupNames.size < 2
                          ? "Buat kelompok tujuan terlebih dahulu."
                          : "Kode pelanggan dan riwayat tetap tersimpan."
                        : "Kelompok ini belum memiliki pelanggan."}
                    </p>
                    <div className="rv-group-delete-actions">
                      <button
                        type="button"
                        className="rv-secondary"
                        onClick={() =>
                          setGroupForm({ ...groupForm, deleting: false })
                        }
                      >
                        Batal
                      </button>
                      <Submit
                        disabled={groupMemberCount > 0 && groupNames.size < 2}
                      >
                        Hapus kelompok
                      </Submit>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rv-customer-group-fields">
                      {!groupForm.edit && (
                        <Field
                          label="Awalan kode"
                          placeholder="G"
                          required
                          maxLength={8}
                          pattern="[A-Z]{1,8}"
                          value={groupForm.prefix}
                          onChange={(e) =>
                            setGroupForm({
                              ...groupForm,
                              prefix: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      )}
                      <Field
                        label="Nama kelompok"
                        placeholder="Mis. Area utara"
                        required
                        maxLength={60}
                        autoFocus={!!groupForm.edit}
                        value={groupForm.name}
                        onChange={(e) =>
                          setGroupForm({ ...groupForm, name: e.target.value })
                        }
                      />
                    </div>
                    {!groupForm.edit &&
                      (groupNames.has(groupForm.prefix) ? (
                        <small className="rv-error">
                          Awalan ini sudah dipakai.
                        </small>
                      ) : (
                        <small className="rv-note">
                          Contoh kode: {groupForm.prefix || "G"}1,{" "}
                          {groupForm.prefix || "G"}2, {groupForm.prefix || "G"}3
                        </small>
                      ))}
                    <Submit>Simpan kelompok</Submit>
                    {groupForm.edit && (
                      <button
                        type="button"
                        className="rv-group-delete-button"
                        onClick={() =>
                          setGroupForm({
                            ...groupForm,
                            deleting: true,
                            moveTo: "",
                          })
                        }
                      >
                        <Trash2 size={14} /> Hapus kelompok
                      </button>
                    )}
                  </>
                )}
              </AppForm>
            )}
            <p className="rv-error">{error}</p>
            {[...groups]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([prefix, { name, people }], index) => (
                <section
                  className={
                    "rv-customer-group rv-customer-tone-" + (index % 3)
                  }
                  key={prefix}
                >
                  <div className="rv-customer-group-header">
                    <button
                      className="rv-customer-group-head"
                      onClick={() => setGroup(group === prefix ? "" : prefix)}
                      aria-expanded={group === prefix || !!search}
                    >
                      <span className="rv-group-code">{prefix}</span>
                      <strong>{name}</strong>
                      <span className="rv-customer-group-count">
                        {people.length} pelanggan
                      </span>
                      <ChevronDown size={16} />
                    </button>
                    {can(data.user, "customers") && (
                      <button
                        type="button"
                        className="rv-customer-group-edit"
                        aria-label={"Atur " + name}
                        title="Ubah atau hapus kelompok"
                        onClick={() =>
                          setGroupForm({ prefix, name, edit: true })
                        }
                      >
                        <SquarePen size={15} />
                      </button>
                    )}
                  </div>
                  {(group === prefix || !!search) && !people.length && (
                    <div className="rv-customer-group-empty">
                      <span>Belum ada pelanggan.</span>
                    </div>
                  )}
                  {(group === prefix || !!search) &&
                    people
                      .sort((a, b) =>
                        a.code.localeCompare(b.code, undefined, {
                          numeric: true,
                        }),
                      )
                      .map((c) => (
                        <div className="rv-group-person" key={c.id}>
                          <button
                            className="rv-data-row"
                            onClick={() => {
                              setSelected(selected?.id === c.id ? null : c);
                              setPurchasePage(0);
                            }}
                            aria-expanded={selected?.id === c.id}
                          >
                            <span className="rv-customer-row-info">
                              <Identity code={c.code} name={c.name} />
                              <small
                                className="rv-note"
                                title="Seluruh transaksi"
                              >
                                {!can(data.user, "reports")
                                  ? c.whatsapp
                                  : Array.isArray(customerPurchases) &&
                                      customerPurchases.find(
                                        (p) => p.id === c.id,
                                      )?.count
                                    ? customerPurchases.find(
                                        (p) => p.id === c.id,
                                      ).count + " transaksi"
                                    : "0 transaksi"}
                              </small>
                            </span>
                            {can(data.user, "reports") && (
                              <strong className="rv-customer-spend">
                                {money(
                                  Array.isArray(customerPurchases)
                                    ? customerPurchases.find(
                                        (p) => p.id === c.id,
                                      )?.total || 0
                                    : 0,
                                )}
                              </strong>
                            )}
                            <ChevronDown size={16} />
                          </button>
                          {selected?.id === c.id && (
                            <div className="rv-data-panel rv-customer-purchases rv-stack">
                              <div className="rv-line rv-customer-contact">
                                <span>
                                  <Phone size={12} />
                                  {c.whatsapp}
                                </span>
                                {can(data.user, "customers") && (
                                  <button
                                    className="rv-text-button"
                                    onClick={() => setForm(c)}
                                  >
                                    <SquarePen size={12} />
                                    Ubah data
                                  </button>
                                )}
                              </div>
                              {c.photo_id && (
                                <PhotoButton
                                  id={c.photo_id}
                                  label={"Rumah " + c.name}
                                />
                              )}
                              {c.location && (
                                <span className="rv-note rv-customer-location">
                                  <MapPin size={12} />
                                  {c.location}
                                </span>
                              )}
                              {can(data.user, "reports") && (
                                <div className="rv-customer-purchase-period">
                                  <Period
                                    value={period}
                                    onChange={(value) => {
                                      setPeriod(value);
                                      setPurchasePage(0);
                                    }}
                                  />
                                </div>
                              )}
                              {can(data.user, "reports") && insight?.stats && (
                                <section
                                  className="rv-customer-ledger"
                                  aria-label="Total dan riwayat pembelian"
                                >
                                  <div className="rv-purchase-overview">
                                    <span>
                                      <span className="rv-customer-total-label">
                                        <Banknote size={12} />
                                        Total belanja
                                      </span>
                                      <strong>
                                        {money(insight.stats.sales)}
                                      </strong>
                                    </span>
                                    <span>{insight.stats.count} transaksi</span>
                                  </div>
                                  {insight.rows.map((row) => (
                                    <details
                                      className="rv-purchase-entry"
                                      key={row.id}
                                    >
                                      <summary className="rv-purchase-trigger">
                                        <span>
                                          <CalendarDays size={12} />
                                          {dateLabel(row.recorded_at)}
                                        </span>
                                        <span
                                          className={
                                            "rv-purchase-payment-badge " +
                                            (row.left > 0
                                              ? "rv-payment-unpaid"
                                              : "rv-payment-paid")
                                          }
                                          aria-label={
                                            row.left > 0
                                              ? "Utang tersisa " +
                                                money(row.left)
                                              : "Pembayaran lunas"
                                          }
                                        >
                                          {row.left > 0
                                            ? "Utang " + money(row.left)
                                            : "Lunas"}
                                        </span>
                                        <strong>{money(row.total)}</strong>
                                        <ChevronDown size={14} />
                                      </summary>
                                      <PurchaseItems row={row} />
                                    </details>
                                  ))}
                                  {!insight.rows.length && (
                                    <span className="rv-note">
                                      Belum ada pembelian pada periode ini.
                                    </span>
                                  )}
                                  {(purchasePage > 0 || insight.hasMore) && (
                                    <div className="rv-customer-ledger-pages">
                                      <button
                                        type="button"
                                        disabled={purchasePage === 0}
                                        onClick={() =>
                                          setPurchasePage(purchasePage - 1)
                                        }
                                      >
                                        Sebelumnya
                                      </button>
                                      <span>
                                        {insight.offset + 1}–
                                        {insight.offset + insight.rows.length}{" "}
                                        dari {insight.stats.count}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={!insight.hasMore}
                                        onClick={() =>
                                          setPurchasePage(purchasePage + 1)
                                        }
                                      >
                                        Berikutnya
                                      </button>
                                    </div>
                                  )}
                                </section>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  {(group === prefix || !!search) &&
                    can(data.user, "customers") && (
                      <button
                        type="button"
                        className="rv-customer-add-in-group"
                        onClick={() => newCustomer(prefix)}
                      >
                        <Plus size={14} />
                        Pelanggan {prefix}
                      </button>
                    )}
                </section>
              ))}
            {!groups.size && (
              <Empty icon={Users}>Belum ada pelanggan yang cocok.</Empty>
            )}
          </>
        )}
      </main>
    </>
  );
}
function ProductEdit() {
  return <Products editing />;
}
function StockHistory() {
  const { data } = useApp();
  const [period, setPeriod, query] = usePeriod(),
    [direction, setDirection] = useState("all"),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [history, error] = useResource(
      "/stock-history?paged=1&" +
        query +
        "&direction=" +
        direction +
        "&search=" +
        encodeURIComponent(search) +
        "&offset=" +
        offset,
      { keepPrevious: true },
    );
  const from = new URLSearchParams(window.location.hash.split("?")[1]).get(
    "from",
  );
  return (
    <>
      <Header
        title="Riwayat stok"
        icon={History}
        back={from === "reports" ? "reports" : "products"}
      />
      <main className="rv-body rv-feature rv-stock-history-body">
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setOffset(0);
          }}
          placeholder="Cari produk atau akun"
        />
        <PeriodFilters
          value={period}
          label="Periode riwayat stok"
          today={data.today}
          onChange={(value) => {
            setPeriod(value);
            setOffset(0);
          }}
        />
        <div
          className="rv-filters"
          role="group"
          aria-label="Jenis pergerakan stok"
        >
          {[
            ["all", "Semua"],
            ["in", "Masuk"],
            ["out", "Keluar"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className="rv-filter"
              aria-pressed={direction === key}
              onClick={() => {
                setDirection(key);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="rv-error" role="alert">
            {error}
          </p>
        )}
        {!history && !error && (
          <p className="rv-note" role="status">
            Memuat riwayat…
          </p>
        )}
        {history && (
          <>
            <div className="rv-section-heading">
              <h3>Pergerakan barang</h3>
              <span className="rv-note">{history.total} catatan</span>
            </div>
            <div className="rv-stock-log-list">
              {history.rows.map((row) => (
                <article
                  className="rv-stock-log-row"
                  key={row.id}
                  style={staffColor(
                    row.actor_username || row.actor_id || row.actor,
                  )}
                >
                  <div className="rv-stock-log-top">
                    <strong>{row.product}</strong>
                    <b
                      className={
                        row.qty < 0 ? "rv-stock-qty-out" : "rv-stock-qty-in"
                      }
                    >
                      <span className="rv-stock-log-kind">
                        {row.kind === "reconcile"
                          ? "Penyesuaian"
                          : row.qty < 0
                            ? "Keluar"
                            : "Masuk"}
                      </span>{" "}
                      {row.qty > 0 ? "+" : ""}
                      {row.qty} <small>unit</small>
                    </b>
                  </div>
                  <div className="rv-stock-log-meta">
                    <time dateTime={row.created_at}>
                      {dateLabel(row.created_at)} · {timeLabel(row.created_at)}
                    </time>
                    <span className="rv-stock-log-actor" title={row.actor}>
                      <UserRound size={12} />
                      <span>{row.actor}</span>
                    </span>
                  </div>
                  {stockMovementNote(row) && (
                    <p className="rv-stock-log-note">
                      {stockMovementNote(row)}
                    </p>
                  )}
                </article>
              ))}
            </div>
            {!history.rows.length && (
              <Empty icon={Package}>
                Belum ada pergerakan stok pada pilihan ini.
              </Empty>
            )}
            {(offset > 0 || history.hasMore) && (
              <div className="rv-stock-log-pagination">
                <button
                  type="button"
                  className="rv-secondary"
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 30))}
                >
                  Sebelumnya
                </button>
                <span>{Math.floor(offset / 30) + 1}</span>
                <button
                  type="button"
                  className="rv-secondary"
                  disabled={!history.hasMore}
                  onClick={() => setOffset(offset + 30)}
                >
                  Berikutnya
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
function Products({ editing = false }) {
  const { data, act } = useApp(),
    [categoryPanel, setCategoryPanel] = useState(null),
    [form, setForm] = useState(() => {
      if (!editing) return null;
      const id = new URLSearchParams(window.location.hash.split("?")[1]).get(
        "id",
      );
      const product = data.products.find((p) => p.id === id);
      return product
        ? {
            ...product,
            categoryId: product.category_id,
            capacityEnabled: product.capacityLiters > 0,
            capacityLiters: product.capacityLiters ?? "",
          }
        : null;
    }),
    [categoryFilter, setCategoryFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [stockEntry, setStockEntry] = useState(null),
    [stockSaved, setStockSaved] = useState(null);
  useEffect(() => {
    if (
      categoryFilter !== "all" &&
      !data.categories.some((c) => c.id === categoryFilter)
    )
      setCategoryFilter("all");
  }, [data.categories, categoryFilter]);
  useEffect(() => {
    if (editing) return;
    const focus = new URLSearchParams(window.location.hash.split("?")[1]).get(
      "focus",
    );
    if (focus)
      document
        .getElementById("catalog-" + focus)
        ?.scrollIntoView({ block: "center" });
  }, [editing]);
  function closeEditor() {
    if (editing)
      navigate("products?focus=" + encodeURIComponent(form?.id || ""));
    else setForm(null);
  }
  function update(key, value) {
    setForm({ ...form, [key]: value });
  }
  async function save(e) {
    e.preventDefault();
    await act(async () => {
      await api(form.id ? "/products/" + form.id : "/products", {
        method: form.id ? "PATCH" : "POST",
        body: {
          ...form,
          categoryId: form.categoryId,
          actualStock: Number(form.actualStock),
          capacityLiters: form.capacityEnabled
            ? Number(form.capacityLiters)
            : null,
          modes: form.modes.map((m) => ({ ...m, price: Number(m.price) })),
        },
      });
      closeEditor();
    }).catch(() => {});
  }
  const productEditor = form ? (
    <AppForm
      className={"rv-card rv-stack" + " rv-product-editor rv-compact-editor"}
      onSubmit={save}
    >
      <div className="rv-section-heading">
        <h3>
          <span className="rv-editor-icon rv-editor-peach">
            <Package size={18} />
          </span>
          {form.id ? "Ubah produk" : "Produk baru"}
        </h3>
        <button
          className="rv-icon-button"
          type="button"
          aria-label="Tutup form produk"
          onClick={closeEditor}
        >
          <X size={17} />
        </button>
      </div>
      <Field
        label="Nama produk"
        placeholder="Nama produk"
        value={form.name}
        onChange={(e) => update("name", e.target.value)}
        required
      />
      <div className="rv-product-meta-row">
        <Field label="Kategori">
          <select
            value={form.categoryId}
            onChange={(e) => update("categoryId", e.target.value)}
            required
          >
            <option value="">Pilih kategori</option>
            {data.categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stok">
          <select
            value={form.tracked ? "yes" : "no"}
            onChange={(e) => update("tracked", e.target.value === "yes")}
          >
            <option value="no">Tanpa batas</option>
            <option value="yes">Stok dicatat</option>
          </select>
        </Field>
      </div>
      <div className="rv-product-capacity">
        <label className="rv-capacity-toggle">
          <input
            type="checkbox"
            checked={!!form.capacityEnabled}
            onChange={(event) =>
              update("capacityEnabled", event.target.checked)
            }
          />
          <span>
            <Droplets size={16} /> Hitung volume air
          </span>
        </label>
        {form.capacityEnabled && (
          <Field label="Kapasitas per unit (liter)">
            <input
              type="number"
              inputMode="decimal"
              min="0.000001"
              max="1000000"
              step="0.000001"
              placeholder="Contoh: 19"
              required
              value={form.capacityLiters ?? ""}
              onChange={(event) => update("capacityLiters", event.target.value)}
            />
          </Field>
        )}
        <small>
          Kapasitas × jumlah terjual dihitung dalam total liter penjualan.
        </small>
      </div>
      {form.modes.map((m, i) => (
        <div className="rv-two rv-product-mode" key={i}>
          <Field
            label="Cara beli"
            value={m.name}
            onChange={(e) =>
              update(
                "modes",
                form.modes.map((x, k) =>
                  k === i ? { ...x, name: e.target.value } : x,
                ),
              )
            }
            required
          />
          <Currency
            label="Harga (Rp)"
            value={m.price}
            onChange={(v) =>
              update(
                "modes",
                form.modes.map((x, k) => (k === i ? { ...x, price: v } : x)),
              )
            }
            required
          />
        </div>
      ))}
      <button
        className="rv-product-add-mode"
        type="button"
        onClick={() =>
          update("modes", [...form.modes, { name: "Beli + galon", price: "0" }])
        }
      >
        <Plus size={14} />
        Tambah cara beli<span>Stok sama</span>
      </button>
      {form.id &&
        form.tracked &&
        !data.products.find((p) => p.id === form.id).tracked && (
          <>
            <Currency
              label="Saldo fisik saat ini"
              value={form.actualStock ?? ""}
              onChange={(v) => update("actualStock", v)}
              min="-1000000"
              required
            />
            <Field
              label="Catatan saldo fisik"
              value={form.stockReason || ""}
              onChange={(e) => update("stockReason", e.target.value)}
              required
            />
          </>
        )}
      {!form.id && form.tracked && (
        <small>Stok awal 0. Tambahkan melalui Stok masuk.</small>
      )}
      <Submit>Simpan produk</Submit>
      {form.id && (
        <button
          type="button"
          className="rv-staff-delete"
          onClick={async () => {
            await act(async () => {
              await api("/products/" + form.id, {
                method: "DELETE",
                body: { version: form.version },
              });
              if (editing) navigate("products");
              else setForm(null);
            }).catch(() => {});
          }}
        >
          <Trash2 size={16} /> Hapus produk
        </button>
      )}
    </AppForm>
  ) : null;
  if (editing)
    return (
      <>
        <Header title="Edit produk" icon={SquarePen} back="products" />
        <main className="rv-body rv-feature rv-products-body">
          {productEditor || (
            <Empty icon={Package}>Produk tidak tersedia.</Empty>
          )}
        </main>
      </>
    );
  return (
    <>
      <Header
        title="Produk & stok"
        icon={Package}
        className="rv-products-header"
      >
        {(can(data.user, "stock") || can(data.user, "reports")) && (
          <div className="rv-catalog-header-actions">
            <button
              type="button"
              className="rv-header-button"
              onClick={() => navigate("stockhistory?from=products")}
            >
              <History size={14} /> Riwayat stok
            </button>
          </div>
        )}
      </Header>
      <main className="rv-body rv-feature rv-products-body">
        {can(data.user, "catalog") && (
          <div className="rv-product-quick-actions">
            <button
              type="button"
              className="rv-stock-history-link rv-add-product-link"
              onClick={() => {
                setCategoryPanel(null);
                setForm({
                  name: "",
                  categoryId: data.categories[0]?.id || "",
                  tracked: false,
                  capacityEnabled: false,
                  capacityLiters: "",
                  modes: [{ name: "Isi ulang", price: "0" }],
                });
              }}
            >
              <Plus size={15} /> Tambah produk
            </button>
            <button
              type="button"
              className="rv-stock-history-link"
              aria-expanded={categoryPanel === "categories"}
              onClick={() => {
                setForm(null);
                setCategoryPanel(
                  categoryPanel === "categories" ? null : "categories",
                );
              }}
            >
              <Grid2X2 size={14} /> Kategori produk
            </button>
            <button
              type="button"
              className="rv-stock-history-link"
              aria-expanded={categoryPanel === "funds"}
              onClick={() => {
                setForm(null);
                setCategoryPanel(categoryPanel === "funds" ? null : "funds");
              }}
            >
              <Wallet size={14} /> Kategori kas
            </button>
          </div>
        )}
        {categoryPanel === "categories" && (
          <CategoryEditor
            data={data}
            act={act}
            onClose={() => setCategoryPanel(null)}
            Field={Field}
            Submit={Submit}
          />
        )}
        {categoryPanel === "funds" && (
          <CashGroupEditor
            data={data}
            act={act}
            onClose={() => setCategoryPanel(null)}
            Field={Field}
            Submit={Submit}
          />
        )}
        {can(data.user, "catalog") && data.archivedProducts?.length > 0 && (
          <details className="rv-card rv-archived-products">
            <summary>Produk dihapus ({data.archivedProducts.length})</summary>
            <div className="rv-stack">
              {data.archivedProducts.map((p) => (
                <div className="rv-line" key={p.id}>
                  <span>{p.name}</span>
                  <button
                    type="button"
                    className="rv-text-button"
                    aria-label={"Pulihkan " + p.name}
                    onClick={async () => {
                      await act(() =>
                        api("/products/" + p.id + "/restore", {
                          method: "POST",
                          body: { version: p.version },
                        }),
                      ).catch(() => {});
                    }}
                  >
                    <RotateCw size={14} /> Pulihkan
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
        {form && !form.id ? (
          productEditor
        ) : (
          <>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Cari produk"
            />
            <div className="rv-section-heading rv-catalog-heading">
              <h3>Daftar produk</h3>
              <span className="rv-catalog-tools">
                <span className="rv-catalog-label">
                  <Grid2X2 size={12} />
                  Kategori
                </span>
                <select
                  aria-label="Filter kategori produk"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">Semua</option>
                  {data.categories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {data.categories.map((c) => {
              const products = data.products.filter(
                (p) =>
                  p.category_id === c.id &&
                  p.name.toLowerCase().includes(search.toLowerCase()) &&
                  (categoryFilter === "all" ||
                    p.category_id === categoryFilter),
              );
              return (
                products.length > 0 && (
                  <section
                    className={
                      "rv-stack rv-catalog-group rv-catalog-tone-" +
                      (data.categories.indexOf(c) % 3)
                    }
                    key={c.id}
                  >
                    <h4 className="rv-catalog-group-title">
                      {c.name}
                      <span>{products.length} produk</span>
                    </h4>
                    {products.map((p) => (
                      <article
                        className="rv-catalog-card"
                        id={"catalog-" + p.id}
                        key={p.id}
                      >
                        <div className="rv-data-row">
                          <span>
                            <strong className="rv-product-name">
                              <span className="rv-product-mark">
                                <Package size={16} />
                              </span>
                              {p.name}
                            </strong>
                            <span className="rv-note">
                              {p.modes.map((m) => money(m.price)).join(" / ")}
                              {p.capacityLiters > 0 && (
                                <> · {formatLiters(p.capacityLiters)}</>
                              )}
                            </span>
                          </span>
                          <span
                            className={
                              "rv-stock-badge " +
                              (!p.tracked
                                ? "rv-stock-unlimited"
                                : p.stock < 0
                                  ? "rv-stock-minus"
                                  : "")
                            }
                          >
                            {p.tracked ? p.stock + " unit" : "Tanpa batas"}
                          </span>
                          <div className="rv-catalog-actions">
                            {can(data.user, "catalog") && (
                              <button
                                type="button"
                                className="rv-catalog-edit"
                                aria-label={"Edit " + p.name}
                                onClick={() =>
                                  navigate(
                                    "productedit?id=" +
                                      encodeURIComponent(p.id),
                                  )
                                }
                              >
                                <SquarePen size={14} /> Edit
                              </button>
                            )}
                            {can(data.user, "stock") && p.tracked && (
                              <button
                                type="button"
                                className="rv-catalog-add-stock"
                                aria-label={"Tambah stok " + p.name}
                                aria-expanded={stockEntry === p.id}
                                aria-controls={"stock-entry-" + p.id}
                                onClick={() => {
                                  setStockEntry(
                                    stockEntry === p.id ? null : p.id,
                                  );
                                  setStockSaved(null);
                                }}
                              >
                                <Plus size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                        {stockEntry === p.id &&
                          can(data.user, "stock") &&
                          p.tracked && (
                            <AppForm
                              id={"stock-entry-" + p.id}
                              className="rv-stack rv-product-stock-form"
                              aria-label={"Tambah stok " + p.name}
                              onSubmit={async (e) => {
                                e.preventDefault();
                                const el = e.currentTarget;
                                const values = new FormData(el);
                                const qty = Number(values.get("qty"));
                                setStockSaved(null);
                                await act(async () => {
                                  await api("/products/" + p.id + "/stock", {
                                    method: "POST",
                                    body: {
                                      qty,
                                      note:
                                        values.get("note")?.trim() ||
                                        "Stok masuk",
                                    },
                                  });
                                  el.reset();
                                  setStockSaved({ id: p.id, qty });
                                }).catch(() => {});
                              }}
                            >
                              <div className="rv-stock-entry-fields">
                                <Field
                                  label="Jumlah"
                                  name="qty"
                                  type="number"
                                  min="1"
                                  max="1000000"
                                  step="1"
                                  inputMode="numeric"
                                  placeholder="0"
                                  required
                                />
                                <Field
                                  label="Catatan (opsional)"
                                  name="note"
                                  placeholder="Stok masuk"
                                  maxLength={500}
                                />
                                <Submit>Simpan</Submit>
                              </div>
                              <span className="rv-stock-saved" role="status">
                                {stockSaved?.id === p.id
                                  ? stockSaved.qty + " unit ditambahkan"
                                  : ""}
                              </span>
                            </AppForm>
                          )}
                      </article>
                    ))}
                  </section>
                )
              );
            })}
            {!data.products.length && (
              <Empty icon={Package}>
                Buat kategori, kemudian tambahkan produk depot.
              </Empty>
            )}
          </>
        )}
      </main>
    </>
  );
}
const staffPages = [
  ["Pesanan", ["orders"]],
  ["Trip pengantaran", ["trips"]],
  ["Pelanggan", ["customers"]],
  ["Transaksi di depot", ["counter"]],
  ["Utang", ["debts"]],
  ["Produk & stok", ["stock", "catalog"]],
  ["Laporan", ["reports"]],
  ["Pengeluaran & kas", ["expenses"]],
  ["Status Delivery", ["display"]],
  ["Absensi staf", ["attendanceView"]],
  ["Kontrol air", ["waterControl"]],
];
function Staff() {
  const { data, act } = useApp(),
    [form, setForm] = useState(null);
  const presets = {
    staff: ["orders", "trips", "customers", "counter", "debts"],
    manager: [...new Set(staffPages.flatMap(([, keys]) => keys))],
  };
  function setPermission(key, checked) {
    setForm({
      ...form,
      permissions: checked
        ? [...form.permissions, key]
        : form.permissions.filter((p) => p !== key),
    });
  }
  const staffEditor = form ? (
    <AppForm
      className={
        (form.id ? "rv-stack rv-editor-inline" : "rv-card rv-stack") +
        " rv-staff-editor rv-compact-editor"
      }
      onSubmit={async (e) => {
        e.preventDefault();
        await act(async () => {
          await api(form.id ? "/staff/" + form.id : "/staff", {
            method: form.id ? "PATCH" : "POST",
            body: form,
          });
          setForm(null);
        }).catch(() => {});
      }}
    >
      <div className="rv-section-heading">
        <h3>
          <span className="rv-editor-icon rv-editor-mint">
            <Users size={18} />
          </span>
          {form.owner
            ? "Akun owner"
            : form.id
              ? "Atur akses"
              : "Akun staf baru"}
        </h3>
        <button
          className="rv-icon-button"
          type="button"
          aria-label="Tutup akun"
          onClick={() => setForm(null)}
        >
          <X size={16} />
        </button>
      </div>
      <div className="rv-two rv-staff-identity-fields">
        <Field
          label={form.owner ? "Nama owner" : "Nama staf"}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <Field
          label="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          minLength={3}
          maxLength={40}
          pattern="[a-zA-Z0-9_.\-]{3,40}"
          autoComplete="off"
          required
        />
      </div>
      {!form.id && (
        <>
          <Field
            label="Kata sandi awal"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            required
          />
          <Field label="Akses awal">
            <select
              value={form.preset || "staff"}
              onChange={(e) =>
                setForm({
                  ...form,
                  preset: e.target.value,
                  permissions: presets[e.target.value],
                })
              }
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
          </Field>
        </>
      )}
      {!form.owner && (
        <>
          <h3>Akses halaman</h3>
          <div className="rv-permission-list">
            {staffPages.map(([label, keys]) => (
              <label className="check-line" key={label}>
                <input
                  type="checkbox"
                  checked={keys.some((key) => form.permissions.includes(key))}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      permissions: e.target.checked
                        ? [...new Set([...form.permissions, ...keys])]
                        : form.permissions.filter((p) => !keys.includes(p)),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label className="check-line">
            <input
              type="checkbox"
              checked={form.permissions.includes("correct")}
              onChange={(e) => setPermission("correct", e.target.checked)}
            />
            Koreksi pembayaran sendiri
          </label>
          {form.id && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Akun aktif
            </label>
          )}
        </>
      )}
      <Submit>Simpan akun</Submit>
    </AppForm>
  ) : null;
  return (
    <>
      <Header title="Karyawan & akses" icon={Users}>
        <button
          className="rv-header-button"
          onClick={() =>
            setForm({
              name: "",
              username: "",
              password: "",
              preset: "staff",
              permissions: presets.staff,
              active: true,
            })
          }
        >
          <Plus size={16} />
          Akun
        </button>
      </Header>
      <main className="rv-body rv-feature rv-staff-body">
        {form && !form.id ? (
          staffEditor
        ) : (
          <>
            <div className="rv-staff-overview">
              <span className="rv-staff-overview-icon">
                <Users size={23} />
              </span>
              <span>
                <strong>{data.staff.length} akun</strong>
                <small>
                  {data.staff.filter((u) => !u.owner && u.active).length} staf
                  aktif
                </small>
              </span>
              <ShieldCheck size={36} aria-hidden="true" />
            </div>
            <div className="rv-section-heading">
              <h3>Akun karyawan</h3>
              <span className="rv-staff-managed">
                <ShieldCheck size={12} />
                Dikelola owner
              </span>
            </div>
            {data.staff
              .slice()
              .sort((a, b) => Number(b.owner) - Number(a.owner))
              .map((u, index) =>
                u.owner ? (
                  <div className="rv-card rv-staff-owner-wrapper" key={u.id}>
                    <button
                      type="button"
                      className="rv-staff-owner rv-owner-edit-toggle"
                      disabled={u.id !== data.user.id}
                      aria-expanded={form?.id === u.id}
                      aria-label={"Edit akun owner " + u.name}
                      onClick={() =>
                        setForm(
                          form?.id === u.id
                            ? null
                            : {
                                ...u,
                                expectedName: u.name,
                                expectedUsername: u.username,
                              },
                        )
                      }
                    >
                      <span className="rv-staff-avatar rv-staff-avatar-owner">
                        <ShieldCheck size={19} />
                      </span>
                      <span className="rv-staff-person">
                        <strong>{u.name}</strong>
                        <small>Owner</small>
                      </span>
                      <span className="rv-staff-owner-badge">
                        Seluruh akses
                      </span>
                      <SquarePen size={17} />
                    </button>
                    {form?.id === u.id && (
                      <div className="rv-data-panel">
                        {staffEditor}
                        <details className="rv-extra">
                          <summary>
                            Ubah sandi
                            <ChevronDown />
                          </summary>
                          <AccountPasswordForm
                            endpoint={"/staff/" + u.id + "/password"}
                          />
                        </details>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={
                      "rv-staff-card rv-staff-tone-" +
                      (index % 3) +
                      (!u.active ? " rv-staff-inactive" : "")
                    }
                    key={u.id}
                  >
                    <button
                      className="rv-data-row"
                      aria-expanded={form?.id === u.id}
                      onClick={() =>
                        setForm(form?.id === u.id ? null : { ...u })
                      }
                    >
                      <span className="rv-staff-avatar">
                        {u.name[0].toUpperCase()}
                      </span>
                      <span className="rv-staff-person">
                        <strong>{u.name}</strong>
                        <span className="rv-note">
                          {u.username}
                          {!u.active ? " · Nonaktif" : ""}
                        </span>
                      </span>
                      <span className="rv-stock-badge rv-stock-unlimited">
                        {
                          staffPages.filter(([, keys]) =>
                            keys.some((key) => u.permissions.includes(key)),
                          ).length
                        }{" "}
                        halaman
                      </span>
                      <ChevronDown />
                    </button>
                    {form?.id === u.id && (
                      <div className="rv-data-panel">
                        {staffEditor}
                        <button
                          type="button"
                          className="rv-staff-delete"
                          disabled={data.user.id === u.id}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Hapus ${u.name} dari daftar staf? Akun tidak dapat masuk lagi. Riwayat transaksi dan absensi tetap disimpan.`,
                              )
                            )
                              return;
                            await act(async () => {
                              await api("/staff/" + u.id, { method: "DELETE" });
                              setForm(null);
                            }).catch(() => {});
                          }}
                        >
                          <Trash2 size={15} />
                          Hapus staf
                        </button>
                        <details className="rv-extra">
                          <summary>
                            Reset kata sandi
                            <ChevronDown />
                          </summary>
                          <AppForm
                            className="rv-stack"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const password = new FormData(
                                e.currentTarget,
                              ).get("password");
                              await act(async () => {
                                await api("/staff/" + u.id + "/password", {
                                  method: "POST",
                                  body: { password },
                                });
                                setForm(null);
                              }).catch(() => {});
                            }}
                          >
                            <Field
                              label="Kata sandi baru"
                              name="password"
                              type="password"
                              autoComplete="new-password"
                              required
                            />
                            <Submit>Simpan kata sandi</Submit>
                          </AppForm>
                        </details>
                      </div>
                    )}
                  </div>
                ),
              )}
          </>
        )}
      </main>
    </>
  );
}
function Attendance() {
  const { data, act } = useApp(),
    [photo, setPhoto] = useState(""),
    own = data.attendance.find((a) => a.user_id === data.user.id);
  return (
    <>
      <Header title="Absensi" icon={Camera} back="other" />
      <main className="rv-body rv-feature">
        {own ? (
          <section className="rv-card rv-my-attendance">
            <span className="rv-menu-icon rv-mint">
              <CheckCircle2 />
            </span>
            <span>
              <strong>{data.user.name} sudah absen</strong>
              <span>
                {dateLabel(own.created_at)} · {timeLabel(own.created_at)} WIB
              </span>
            </span>
            <PhotoButton id={own.photo_id} label="Foto absensi saya" />
          </section>
        ) : (
          <AppForm
            className="rv-card rv-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await act(() =>
                api("/attendance", { method: "POST", body: { photo } }),
              ).catch(() => {});
            }}
          >
            <h3>Absen masuk</h3>
            <CameraCapture
              facing="user"
              label="Foto di depot"
              photo={photo}
              onChange={setPhoto}
            />
            <Submit disabled={!photo}>Catat kehadiran</Submit>
          </AppForm>
        )}
      </main>
    </>
  );
}
function Corrections() {
  const { act } = useApp(),
    [reload, setReload] = useState(0),
    [rows, error] = useResource("/payments?refresh=" + reload),
    [selected, setSelected] = useState(null);
  return (
    <>
      <Header title="Koreksi pembayaran" icon={SquarePen} back="settings" />
      <main className="rv-body">
        <p className="rv-error">{error}</p>
        {rows?.map((p) => (
          <section className="rv-card rv-stack" key={p.id}>
            <button
              className="rv-data-row"
              onClick={() =>
                setSelected(selected?.id === p.id ? null : { ...p, reason: "" })
              }
            >
              <span>
                <strong>{p.customer || "Pembeli umum"}</strong>
                <small>
                  {dateLabel(p.created_at)} · {p.actor} · {p.method}
                </small>
              </span>
              <strong>{money(p.amount)}</strong>
              <ChevronDown size={15} />
            </button>
            {selected?.id === p.id && (
              <AppForm
                className="rv-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await act(async () => {
                    await api("/payments/" + p.id, {
                      method: "PATCH",
                      body: {
                        version: p.version,
                        amount: Number(selected.amount),
                        method: selected.method,
                        reason: selected.reason,
                      },
                    });
                    setSelected(null);
                    setReload((v) => v + 1);
                  }).catch(() => {});
                }}
              >
                <div className="rv-two">
                  <Currency
                    label="Nominal yang benar"
                    value={selected.amount}
                    onChange={(v) => setSelected({ ...selected, amount: v })}
                    required
                  />
                  <Field label="Metode">
                    <select
                      value={selected.method}
                      onChange={(e) =>
                        setSelected({ ...selected, method: e.target.value })
                      }
                    >
                      <option>Tunai</option>
                      <option>QRIS</option>
                    </select>
                  </Field>
                </div>
                <Field
                  label="Alasan koreksi"
                  value={selected.reason}
                  onChange={(e) =>
                    setSelected({ ...selected, reason: e.target.value })
                  }
                  required
                />
                {p.proof_id && (
                  <PhotoButton id={p.proof_id} label="Bukti QRIS" />
                )}
                <Submit>Simpan koreksi</Submit>
              </AppForm>
            )}
          </section>
        ))}
        {rows && !rows.length && (
          <Empty>Belum ada pembayaran yang dapat dikoreksi.</Empty>
        )}
      </main>
    </>
  );
}
function SettingsPage() {
  const { data, act, busy, preferences, savePreferences } = useApp(),
    [message, setMessage] = useState("");
  return (
    <>
      <Header title="Pengaturan" icon={Settings} />
      <main className="rv-body rv-feature rv-settings-body">
        {data.user.owner && (
          <DurationCategoryEditor
            settings={data.settings}
            busy={busy}
            onSave={(durationCategories) =>
              act(() =>
                api("/settings", {
                  method: "PATCH",
                  body: { durationCategories },
                }),
              )
            }
          />
        )}
        <section
          className="rv-card rv-stack rv-appearance-settings rv-settings-card"
          aria-labelledby="rv-appearance-title"
        >
          <div className="rv-settings-card-head">
            <span className="rv-settings-symbol">
              <Palette size={18} />
            </span>
            <h3 id="rv-appearance-title">Tampilan aplikasi</h3>
            <span className="rv-settings-badge">
              <Check size={11} />
              Otomatis
            </span>
          </div>
          <div className="rv-appearance-controls">
            <Field
              label={
                <span>
                  <Type size={15} />
                  Ukuran teks
                </span>
              }
            >
              <select
                value={preferences.text}
                onChange={(e) =>
                  savePreferences({ ...preferences, text: e.target.value })
                }
              >
                <option value="normal">Standar</option>
                <option value="large">Lebih besar</option>
              </select>
            </Field>
            <Field
              label={
                <span>
                  <Rows3 size={15} />
                  Kerapatan
                </span>
              }
            >
              <select
                value={preferences.density}
                onChange={(e) =>
                  savePreferences({ ...preferences, density: e.target.value })
                }
              >
                <option value="comfortable">Nyaman</option>
                <option value="compact">Ringkas</option>
              </select>
            </Field>
            <Field
              label={
                <span>
                  <CalendarDays size={15} />
                  Periode awal
                </span>
              }
            >
              <select
                value={preferences.period}
                onChange={(e) =>
                  savePreferences({ ...preferences, period: e.target.value })
                }
              >
                <option value="today">Hari ini</option>
                <option value="yesterday">Kemarin</option>
                <option value="week">Minggu ini</option>
                <option value="month">Bulan ini</option>
              </select>
            </Field>
          </div>
          <p className="rv-settings-footnote">
            Tersimpan di perangkat ini. Periode awal untuk Beranda dan Laporan ·
            WIB.
          </p>
        </section>
        <details className="rv-card rv-extra">
          <summary>
            Akun dan catatan
            <ChevronDown />
          </summary>
          <div className="rv-stack">
            {can(data.user, "correct") && (
              <button
                className="rv-card menu-item"
                onClick={() => navigate("corrections")}
              >
                <History size={21} />
                <span>
                  <strong>Koreksi pembayaran</strong>
                  <small>Perbaiki nominal dengan catatan</small>
                </span>
                <ChevronRight size={17} />
              </button>
            )}
            {can(data.user, "reports") && (
              <button
                className="rv-card menu-item"
                onClick={() => navigate("audit")}
              >
                <ShieldCheck size={21} />
                <span>
                  <strong>Riwayat perubahan</strong>
                  <small>Penanggung jawab setiap pencatatan</small>
                </span>
                <ChevronRight size={17} />
              </button>
            )}
            {data.authProvider === "supabase" ? (
              <p className="rv-note">
                Kata sandi akun ini dikelola melalui Supabase Auth. Hubungi
                owner untuk pemulihan akses.
              </p>
            ) : (
              <AppForm
                className="rv-card rv-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    body = Object.fromEntries(new FormData(form));
                  await act(() => api("/password", { method: "POST", body }))
                    .then(() => {
                      form.reset();
                      setMessage("Kata sandi diperbarui.");
                    })
                    .catch(() => {});
                }}
              >
                <h3>Ganti kata sandi saya</h3>
                <Field
                  label="Kata sandi baru"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                />
                <Submit>Ganti kata sandi</Submit>
              </AppForm>
            )}
            <p className="success" role="status">
              {message}
            </p>
          </div>
        </details>
      </main>
    </>
  );
}
function Audit() {
  const [rows, error] = useResource("/audit");
  const labels = {
    "order.create": "Pesanan baru",
    "order.status": "Status pesanan",
    "order.items": "Produk pesanan",
    "trip.depart": "Keberangkatan",
    "order.complete": "Transaksi selesai",
    "trip.result": "Hasil antar",
    "payment.create": "Pembayaran",
    "cash.expense": "Pengeluaran",
    "cash.transfer": "Transfer / setoran",
    "cash.void": "Pembatalan catatan kas",
    "cash.setup": "Saldo awal",
    "cash.classify": "Pemetaan kas produk",
    "payment.correct": "Koreksi pembayaran",
    "category.create": "Kategori baru",
    "category.update": "Kas kategori diubah",
    "product.create": "Produk baru",
    "cash-fund.create": "Kas baru",
    "cash-fund.update": "Ubah nama kas",
    "product.update": "Perubahan produk",
    "stock.in": "Stok masuk",
    "customer.create": "Pelanggan baru",
    "customer.update": "Data pelanggan",
    "customer-group.create": "Kelompok pelanggan baru",
    "customer-group.update": "Nama kelompok diubah",
    "customer-group.delete": "Kelompok pelanggan dihapus",
    "attendance.in": "Absensi masuk",
    "staff.create": "Akun baru",
    "staff.archive": "Staf dihapus dari daftar",
    "staff.update": "Akses staf",
    "staff.password-reset": "Reset kata sandi",
    "password.change": "Ganti kata sandi",
    "settings.update": "Pengaturan depot",
  };
  function detail(value) {
    if (!value) return null;
    const record = JSON.parse(value);
    return (
      <div className="rv-stack">
        {record.amount !== undefined && (
          <div className="rv-line">
            <span>Nominal</span>
            <strong>{money(record.amount)}</strong>
          </div>
        )}
        {record.method && (
          <div className="rv-line">
            <span>Metode</span>
            <strong>{record.method}</strong>
          </div>
        )}
        {record.name && <span>{record.name}</span>}
        {record.movedTo && (
          <span>
            {record.moved} pelanggan dipindahkan ke kelompok {record.movedTo}
          </span>
        )}
        {record.status && <span>{statuses[record.status]}</span>}
        {record.outcome && <span>{statuses[record.outcome]}</span>}
        {record.qty !== undefined && <span>{record.qty} unit</span>}
        {record.reason && <span>{record.reason}</span>}
        {record.note && <span>{record.note}</span>}
      </div>
    );
  }
  return (
    <>
      <Header title="Riwayat perubahan" icon={ShieldCheck} back="settings" />
      <main className="rv-body">
        <p className="rv-error">{error}</p>
        {rows?.map((row) => (
          <details className="rv-card audit-row" key={row.id}>
            <summary>
              <span>
                <strong>{row.actor}</strong>
                <small>
                  {dateLabel(row.created_at)} · {timeLabel(row.created_at)}
                </small>
              </span>
              <span className="rv-soft-label">
                {labels[row.action] || "Perubahan catatan"}
              </span>
            </summary>
            <div className="rv-purchase-detail">
              {row.before_json && (
                <>
                  <small>Sebelumnya</small>
                  {detail(row.before_json)}
                </>
              )}
              {row.after_json && (
                <>
                  <small>Dicatat</small>
                  {detail(row.after_json)}
                </>
              )}
            </div>
          </details>
        ))}
      </main>
    </>
  );
}
function Display() {
  const { data, tick } = useApp(),
    [filter, setFilter] = useState("active"),
    [landscape, setLandscape] = useState(false),
    landscapeRef = useRef(null),
    [state, error] = useResource(
      "/display?day=" + data.today + "&filter=" + filter,
    );
  useEffect(() => {
    if (!landscape) return;
    const dialog = landscapeRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previous;
    };
  }, [landscape]);
  const View = landscape ? "dialog" : "section";
  return (
    <View
      ref={landscapeRef}
      className={"rv-display-view" + (landscape ? " rv-display-landscape" : "")}
      aria-label="Tampilan status pengantaran"
      onCancel={(e) => {
        e.preventDefault();
        setLandscape(false);
      }}
    >
      <Header
        title="Sanz Water"
        icon={BrandMark}
        filters={
          <OrderStatusFilters
            value={filter}
            onChange={setFilter}
            label="Filter pesanan TV"
          />
        }
      >
        <button
          type="button"
          className="rv-header-button"
          aria-pressed={landscape}
          onClick={() => setLandscape(!landscape)}
        >
          <RotateCw size={16} />
          {landscape ? "Kembali" : "Putar layar"}
        </button>
      </Header>
      <main className="rv-body rv-display-body">
        <p className="rv-error">{error}</p>
        <div className="display-table">
          <table>
            <thead>
              <tr>
                {["Pelanggan", "Produk", "Durasi", "Status", "Kurir"].map(
                  (h) => (
                    <th key={h}>{h}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {sortDisplayOrders(state?.orders || [], tick).map((o) => (
                <tr key={o.id}>
                  <td>
                    <Identity code={o.code} name={o.name} />
                    {new Date(Date.parse(o.received_at) + 25200000)
                      .toISOString()
                      .slice(0, 10) !== data.today && (
                      <small className="rv-tv-order-date">
                        {dateLabel(o.received_at)} · {timeLabel(o.received_at)}
                      </small>
                    )}
                  </td>
                  <td>
                    {o.items.map((l) => l.qty + " " + l.name).join(" + ") ||
                      "Belum diisi"}
                  </td>
                  <td>
                    <DurationChip
                      minutes={duration(o, tick)}
                      settings={data.settings}
                    />
                  </td>
                  <td>{statuses[o.status]}</td>
                  <td>{o.courier || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state && !state.orders.length && (
            <Empty>Belum ada pesanan aktif.</Empty>
          )}
        </div>
      </main>
    </View>
  );
}
const { AccountMenu, AccountPasswordForm } = createAccountMenu({
  useApp,
  Field,
  Submit,
  useResource,
  PhotoButton,
});
const WaterControl = createWaterControl({
  useApp,
  Header,
  Field,
  Submit,
  useResource,
});
const WaterReports = createWaterReports({
  useApp,
  Header,
  usePeriod,
  useResource,
  PhotoButton,
});
const approvedPages = createApprovedPages({
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
});
