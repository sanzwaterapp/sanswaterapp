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
  Clock,
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
  function OwnAttendance({ onPhoto }) {
    const { act, data, setPhoto: showPhoto } = useApp();
    const day = new Date(new Date(data.now).getTime() + 7 * 3600000)
      .toISOString()
      .slice(0, 10);
    const [revision, setRevision] = useState(0),
      [info, loadError] = useResource(
        "/account/attendance?revision=" + revision + "&day=" + day,
      );
    const [camera, setCamera] = useState(false),
      [photo, setPhoto] = useState(""),
      [error, setError] = useState("");
    return (
      <div className="rv-stack">
        {loadError && (
          <p className="rv-error" role="alert">
            {loadError}
          </p>
        )}
        {!info && !loadError && <LoadingState compact />}
        {info && (
          <>
            <div
              className={
                "rv-account-attendance " + (info.current ? "is-present" : "")
              }
            >
              {info.current ? <CheckCircle2 size={21} /> : <Clock size={21} />}
              <span>
                <strong>
                  {info.current
                    ? "Sudah absen hari ini"
                    : "Belum absen hari ini"}
                </strong>
                <small>
                  {dateLabel(info.today)}
                  {info.current
                    ? " · " + timeLabel(info.current.created_at)
                    : ""}
                </small>
              </span>
            </div>
            {!info.current && (
              <button
                type="button"
                className={photo ? "rv-secondary" : "rv-primary"}
                aria-haspopup="dialog"
                onClick={() => {
                  setCamera(true);
                  setError("");
                }}
              >
                <Camera size={17} />
                {photo ? "Ubah foto absensi" : "Absen masuk"}
              </button>
            )}
            {!info.current && camera && (
              <CaptureScreen
                title="Foto absensi"
                caption="Foto di depot"
                facing="user"
                photo={photo}
                onUse={setPhoto}
                onClose={() => setCamera(false)}
              />
            )}
            {!info.current && photo && (
              <AppForm
                className="rv-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError("");
                  try {
                    await act(() =>
                      api("/attendance", { method: "POST", body: { photo } }),
                    );
                    setPhoto("");
                    setCamera(false);
                    setRevision((n) => n + 1);
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                {error && (
                  <p className="rv-error" role="alert">
                    {error}
                  </p>
                )}
                <Submit disabled={!photo}>Catat kehadiran</Submit>
                <button
                  className="rv-text-button"
                  type="button"
                  onClick={() => {
                    setCamera(false);
                    setPhoto("");
                  }}
                >
                  Batal
                </button>
              </AppForm>
            )}
            <h3 className="rv-account-log-title">Absensi terakhir</h3>
            <div className="rv-account-attendance-log">
              {info.rows.map((row) => (
                <div key={row.id}>
                  <span>
                    {dateLabel(row.day)}
                    <small>{timeLabel(row.created_at)}</small>
                  </span>
                  <button
                    type="button"
                    className="rv-attendance-photo"
                    aria-label={"Foto absensi " + dateLabel(row.day)}
                    onClick={() => {
                      onPhoto();
                      showPhoto({
                        id: row.photo_id,
                        label: "Foto absensi " + dateLabel(row.day),
                      });
                    }}
                  >
                    <Camera size={16} />
                  </button>
                </div>
              ))}
              {!info.rows.length && <small>Belum ada absensi.</small>}
            </div>
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
  return { AccountMenu, AccountPasswordForm };
}
