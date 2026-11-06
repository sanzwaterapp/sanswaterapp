import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Camera, RotateCw, Check, X } from "lucide-react";
import { encodePhoto } from "./photo-encoding.js";
import { imageFile } from "./api.js";

export function CameraCapture({ photo, onChange, label, facing, allowFile = false }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="capture">
      <button
        className="secondary"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Camera size={17} aria-hidden="true" />
        {label}{photo && " ✓"}
      </button>
      {open && (
        <CaptureScreen
          title={label}
          facing={facing}
          photo={photo}
          allowFile={allowFile}
          onUse={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function CameraScreenHeader({
  title, titleId, detail, icon: Icon = Camera, onClose, closeLabel = "Tutup kamera",
}) {
  return (
    <header className="rv-departure-top">
      <span className="rv-departure-symbol"><Icon size={22} aria-hidden="true" /></span>
      <span className="rv-departure-title">
        <strong id={titleId}>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <button type="button" className="rv-icon-button" aria-label={closeLabel} onClick={onClose}>
        <X size={22} aria-hidden="true" />
      </button>
    </header>
  );
}

export function CaptureScreen({ title, detail, caption = title, facing, photo, allowFile, onUse, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  const [draft, setDraft] = useState(photo || "");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function pickPhoto(event) {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    setReading(true);
    try {
      setDraft(await imageFile(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setReading(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="rv-departure-page rv-camera-screen"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <CameraScreenHeader title={title} titleId={titleId} detail={detail} onClose={onClose} />
      <DepartureCamera facing={facing} caption={caption} alt={title} photo={draft} onChange={setDraft} />
      <div className="rv-departure-bottom">
        {allowFile && (
          <label className="rv-camera-file">
            {reading ? "Menyiapkan foto…" : "Pilih berkas"}
            <input type="file" accept="image/*" aria-label={"Pilih berkas " + title} disabled={reading} onChange={pickPhoto} />
          </label>
        )}
        {error && <p className="rv-error" role="alert">{error}</p>}
        <button
          className="rv-primary"
          type="button"
          disabled={!draft || reading}
          onClick={() => {
            onUse(draft);
            onClose();
          }}
        >
          Gunakan foto <Check size={16} aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}

export default function DepartureCamera({
  photo,
  onChange,
  facing = "environment",
  caption = "Foto muatan",
  alt = "Foto muatan trip",
}) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (photo) return;
    let active = true,
      stream;
    const timer = setTimeout(() => {
      if (active) setError("Kamera belum aktif.");
    }, 8000);
    setReady(false);
    setError("");
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error();
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
          },
          audio: false,
        });
        clearTimeout(timer);
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.current.srcObject = stream;
        setError("");
        await video.current.play();
      } catch {
        clearTimeout(timer);
        stream?.getTracks().forEach((track) => track.stop());
        if (active) setError("Kamera belum tersedia.");
      }
    }
    start();
    return () => {
      clearTimeout(timer);
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [photo, attempt, facing]);
  function capture() {
    const source = video.current;
    if (!source?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const frameRatio = source.clientWidth && source.clientHeight
      ? source.clientWidth / source.clientHeight
      : source.videoWidth / source.videoHeight;
    const width = Math.min(source.videoWidth, source.videoHeight * frameRatio);
    const height = Math.min(source.videoHeight, source.videoWidth / frameRatio);
    const scale = Math.min(1, 1280 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
      .getContext("2d")
      .drawImage(source, (source.videoWidth - width) / 2, (source.videoHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
    try {
      onChange(encodePhoto(canvas));
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <div
      className={
        "rv-departure-camera" + (facing === "user" ? " rv-selfie-camera" : "")
      }
    >
      <div className="rv-camera-view">
        <span className="rv-camera-caption">
          {photo ? <Check size={14} /> : <Camera size={14} />}
          {photo ? "Foto siap" : caption}
        </span>
        {photo ? (
          <img src={photo} alt={alt} />
        ) : (
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            onLoadedData={() => setReady(true)}
          />
        )}
        {!photo && !ready && (
          <div className="rv-camera-placeholder">
            <Camera size={38} />
            <span>{error || "Menyiapkan kamera…"}</span>
          </div>
        )}
        {ready && error && (
          <p className="rv-error" role="alert">
            {error}
          </p>
        )}
        {!photo && (
          <div className="rv-camera-guides" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        <div className="rv-camera-actions">
          <button
            className="rv-camera-shutter"
            type="button"
            disabled={!photo && !ready && !error}
            onClick={() =>
              photo
                ? onChange("")
                : error
                  ? setAttempt((value) => value + 1)
                  : capture()
            }
          >
            <span className="rv-camera-shutter-ring">
              {photo ? <RotateCw size={25} /> : <Camera size={25} />}
            </span>
            <span>{photo ? "Ambil ulang" : error ? "Coba lagi" : "Ambil gambar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
