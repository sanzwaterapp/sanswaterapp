import React, { useState } from "react";
import {
  UserRound,
  Settings,
  KeyRound,
  LogOut,
  X,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import AppForm from "./AppForm.jsx";
import { LoadingState } from "./OverlayDialog.jsx";
import AccountPopover from "./AccountPopover.jsx";
import { CaptureScreen } from "./DepartureCamera.jsx";
import { api, dateLabel, timeLabel } from "./api.js";

export function createAccountMenu({
  useApp,
  Field,
  Submit,
  useResource,
  PhotoButton,
}) {
  function AccountPasswordForm({ endpoint = "/password" }) {
    const { act } = useApp();
    const [error, setError] = useState(""),
      [saved, setSaved] = useState(false);
    return (
      <AppForm
        className="rv-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            values = new FormData(form);
          setError("");
          setSaved(false);
          try {
            await act(() =>
              api(endpoint, {
                method: "POST",
                body: {
                  password: values.get("password"),
                },
              }),
            );
            form.reset();
            setSaved(true);
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <Field
          label="Kata sandi baru"
          name="password"
          type="password"
          required
          autoComplete="new-password"
        />
        <small>Perangkat lain akan diminta masuk kembali.</small>
        {error && (
          <p className="rv-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="rv-account-success" role="status">
            <CheckCircle2 size={16} />
            Kata sandi sudah diubah.
          </p>
        )}
        <Submit>Simpan kata sandi</Submit>
      </AppForm>
    );
  }
  function ProfileForm({ onSaved }) {
    const { data, act } = useApp();
    const [original] = useState(data.user);
    const [name, setName] = useState(original.name),
      [username, setUsername] = useState(original.username);
    const [error, setError] = useState("");
    return (
      <AppForm
        className="rv-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await act(() =>
              api("/account", {
                method: "PATCH",
                body: {
                  name,
                  username,
                  expectedName: original.name,
                  expectedUsername: original.username,
                },
              }),
            );
            onSaved();
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <Field
          label="Nama akun"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Field
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={40}
          pattern="[a-zA-Z0-9_.\-]{3,40}"
          autoComplete="username"
        />
        {error && (
          <p className="rv-error" role="alert">
            {error}
          </p>
        )}
        <Submit>Simpan akun</Submit>
      </AppForm>
    );
  }
  function OwnAttendance({ onPhoto, showHistory = true }) {
    const { act, busy, data, setPhoto: showPhoto } = useApp();
    const [info, loadError, setInfo] = useResource(
      "/account/attendance?day=" + data.today,
    );
    const [shift, setShift] = useState(null);
    async function sendAttendance(photo) {
      const entry = await act(() =>
        api("/attendance", { method: "POST", body: { photo, shift } }),
      );
      if (!entry)
        throw new Error("Sedang menyimpan perubahan. Coba kirim lagi.");
      setInfo((previous) =>
        previous?.today === entry.day
          ? {
              ...previous,
              shifts: [
                ...previous.shifts.filter((row) => row.shift !== shift),
                entry,
              ],
              rows: [
                entry,
                ...previous.rows.filter((row) => row.id !== entry.id),
              ].slice(0, 14),
            }
          : previous,
      );
    }
    return (
      <div className="rv-stack rv-attendance-panel">
        {loadError && (
          <p className="rv-error" role="alert">
            {loadError}
          </p>
        )}
        {!info && !loadError && <LoadingState compact />}
        {info && (
          <>
            <div className="rv-attendance-heading">
              <strong>Absensi hari ini</strong>
              <time dateTime={info.today}>{dateLabel(info.today)}</time>
            </div>
            <div className="rv-attendance-shifts">
              {[1, 2].map((number) => {
                const entry = info.shifts.find((row) => row.shift === number);
                const Icon = entry ? CheckCircle2 : Camera;
                return (
                  <button
                    key={number}
                    type="button"
                    className={
                      "rv-account-attendance" + (entry ? " is-present" : "")
                    }
                    aria-label={
                      entry
                        ? "Lihat foto absen Shift " + number
                        : "Absen Shift " + number
                    }
                    aria-haspopup="dialog"
                    disabled={busy}
                    onClick={() => {
                      if (entry) {
                        onPhoto?.();
                        showPhoto({
                          id: entry.photo_id,
                          label: "Absensi Shift " + number,
                        });
                      } else {
                        setShift(number);
                      }
                    }}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>Shift {number}</strong>
                      <small>
                        {entry
                          ? timeLabel(entry.created_at) + " WIB"
                          : "Absen masuk"}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            {shift && (
              <CaptureScreen
                title={"Foto absensi Shift " + shift}
                caption="Foto di depot"
                facing="user"
                confirmLabel="Kirim Absensi"
                onUse={sendAttendance}
                onClose={() => setShift(null)}
              />
            )}
            {showHistory && info.rows.length > 0 && (
              <section
                className="rv-account-history"
                aria-label="Riwayat absensi"
              >
                <h3>Riwayat absensi</h3>
                <div className="rv-account-attendance-log">
                  {info.rows.map((row) => {
                    const label =
                      "Foto absensi " +
                      dateLabel(row.day) +
                      (row.shift ? " · Shift " + row.shift : "");
                    return (
                      <div key={row.id}>
                        <span className="rv-attendance-history-meta">
                          <time dateTime={row.day}>{dateLabel(row.day)}</time>
                          <span className="rv-attendance-history-chips">
                            <b>{row.shift ? "Shift " + row.shift : "Masuk"}</b>
                            <time dateTime={row.created_at}>
                              {timeLabel(row.created_at)} WIB
                            </time>
                          </span>
                        </span>
                        <button
                          type="button"
                          className="rv-attendance-photo"
                          aria-label={label}
                          onClick={() => {
                            onPhoto?.();
                            showPhoto({ id: row.photo_id, label });
                          }}
                        >
                          <Camera size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    );
  }
  function AccountMenu({ anchorRef, onClose, onLogout }) {
    const { data } = useApp(),
      [view, setView] = useState("menu"),
      [saved, setSaved] = useState(false);
    return (
      <AccountPopover
        anchorRef={anchorRef}
        view={data.user.owner ? view : "attendance"}
        onClose={onClose}
        aria-labelledby="rv-account-title"
      >
        <header className="rv-account-heading">
          {view !== "menu" && (
            <button
              type="button"
              className="rv-icon-button"
              aria-label="Kembali ke menu akun"
              onClick={() => setView("menu")}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span>
            <h2 id="rv-account-title">
              {view === "profile"
                ? "Pengaturan akun"
                : view === "password"
                  ? "Ubah sandi"
                  : data.user.name}
            </h2>
            <small>
              {data.user.owner ? "Owner" : "Staf"} · {data.user.username}
            </small>
          </span>
          <button
            type="button"
            className="rv-icon-button"
            aria-label="Tutup menu akun"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="rv-account-content">
          {view === "profile" ? (
            <ProfileForm
              onSaved={() => {
                setView("menu");
                setSaved(true);
              }}
            />
          ) : view === "password" ? (
            <AccountPasswordForm />
          ) : (
            <>
              {saved && (
                <p className="rv-account-success" role="status">
                  <CheckCircle2 size={16} />
                  Akun sudah diperbarui.
                </p>
              )}
              {data.user.owner ? (
                <div className="rv-account-options">
                  <button onClick={() => setView("profile")}>
                    <Settings size={19} />
                    <span>Pengaturan akun</span>
                    <ChevronRight size={16} />
                  </button>
                  <button onClick={() => setView("password")}>
                    <KeyRound size={19} />
                    <span>Ubah sandi</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              ) : (
                <OwnAttendance onPhoto={onClose} />
              )}
              <button
                type="button"
                className="rv-account-logout"
                onClick={onLogout}
              >
                <LogOut size={18} />
                Log out
              </button>
            </>
          )}
        </div>
      </AccountPopover>
    );
  }
  return { AccountMenu, AccountPasswordForm, OwnAttendance };
}
