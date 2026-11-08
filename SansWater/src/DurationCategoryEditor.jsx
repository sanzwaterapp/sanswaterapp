import AppForm from "./AppForm.jsx";
import { browserId } from "./api.js";
import React, { useState } from "react";
import { Plus, X, Check, Timer } from "lucide-react";
import {
  durationCategories,
  validDurationCategories,
  bandRange,
} from "./duration-settings.js";

export default function DurationCategoryEditor({ settings, onSave, busy }) {
  const [bands, setBands] = useState(() => durationCategories(settings)),
    [message, setMessage] = useState("");
  const valid = validDurationCategories(bands);
  function update(id, key, value) {
    setMessage("");
    setBands((previous) =>
      previous.map((band) =>
        band.id === id ? { ...band, [key]: value } : band,
      ),
    );
  }
  return (
    <AppForm
      className="rv-card rv-stack rv-duration-editor rv-settings-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        try {
          await onSave(
            bands
              .slice()
              .sort((a, b) => a.from - b.from)
              .map((b) => ({ ...b, name: b.name.trim() })),
          );
          setMessage("Kategori dan warna tersimpan.");
        } catch {
          /* App displays the save error. */
        }
      }}
    >
      <div className="rv-settings-card-head">
        <span className="rv-settings-symbol">
          <Timer size={18} />
        </span>
        <h3>Kategori durasi & warna</h3>
        <span className="rv-settings-badge">{bands.length} kategori</span>
      </div>
      <p className="rv-settings-description">
        Atur nama, awal menit, dan warna. Rentang mengikuti kategori berikutnya.
      </p>
      <div className="rv-duration-column-head" aria-hidden="true">
        <span>Nama kategori</span>
        <span>Mulai · mnt</span>
        <span>Warna</span>
        <span />
      </div>
      <div className="rv-duration-band-list">
        {bands.map((band, index) => (
          <div
            className="rv-duration-band-row"
            key={band.id}
            style={{ "--band-color": band.color }}
          >
            <label className="rv-field">
              <span className="rv-duration-field-label">Nama kategori</span>
              <input
                aria-label={`Nama kategori ${index + 1}`}
                value={band.name}
                maxLength={24}
                required
                onChange={(e) => update(band.id, "name", e.target.value)}
              />
            </label>
            <label className="rv-field">
              <span className="rv-duration-field-label">Mulai (mnt)</span>
              <input
                aria-label={`Mulai kategori ${index + 1}`}
                type="number"
                min="0"
                max="1440"
                step="1"
                value={band.from}
                readOnly={index === 0}
                required
                onChange={(e) =>
                  update(band.id, "from", Number(e.target.value))
                }
              />
            </label>
            <label className="rv-field">
              <span className="rv-duration-field-label">Warna</span>
              <input
                aria-label={`Warna kategori ${index + 1}`}
                type="color"
                value={band.color}
                onChange={(e) => update(band.id, "color", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rv-icon-button"
              aria-label={`Hapus kategori ${band.name}`}
              disabled={bands.length === 1}
              onClick={() => {
                setMessage("");
                setBands((previous) =>
                  previous
                    .filter((b) => b.id !== band.id)
                    .map((b, i) => (i === 0 ? { ...b, from: 0 } : b)),
                );
              }}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="rv-add-duration-band"
        type="button"
        disabled={
          bands.length >= 8 || Math.max(...bands.map((b) => b.from)) >= 1440
        }
        onClick={() => {
          setMessage("");
          setBands([
            ...bands,
            {
              id: browserId(),
              name: `Kategori ${bands.length + 1}`,
              from: Math.min(1440, Math.max(...bands.map((b) => b.from)) + 30),
              color: "#7059c9",
            },
          ]);
        }}
      >
        <Plus size={15} />
        Tambah kategori
      </button>
      {valid ? (
        <div className="rv-duration-preview" aria-label="Pratinjau kategori">
          {bands
            .slice()
            .sort((a, b) => a.from - b.from)
            .map((band) => (
              <span
                key={band.id}
                style={{
                  "--band-color": band.color,
                }}
              >
                <i aria-hidden="true" />
                <b>{band.name}</b>
                <small>{bandRange(bands, band.id)}</small>
              </span>
            ))}
        </div>
      ) : (
        <p className="rv-error" role="alert">
          Nama dan batas menit harus berbeda; mulai dari 0, hingga 1440 menit.
        </p>
      )}
      <button className="rv-primary" type="submit" disabled={!valid || busy}>
        {busy ? "Menyimpan…" : "Simpan kategori"}
        <Check size={16} />
      </button>
      <p className="rv-settings-footnote">
        Dipakai di Pesanan, Beranda, dan Status Delivery.
      </p>
      {message && (
        <span role="status" className="rv-note">
          {message}
        </span>
      )}
    </AppForm>
  );
}
