import React, { useEffect, useRef, useState } from "react";
import { Camera, RotateCw, Check } from "lucide-react";
import { encodePhoto } from "./photo-encoding.js";

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
    const scale = Math.min(1, 1400 / source.videoWidth);
    canvas.width = source.videoWidth * scale;
    canvas.height = source.videoHeight * scale;
    canvas
      .getContext("2d")
      .drawImage(source, 0, 0, canvas.width, canvas.height);
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
            <span>{photo ? "Ambil ulang" : "Ambil gambar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
