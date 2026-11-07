import React, { useEffect, useState } from "react";
import {
  Droplets,
  Camera,
  RefreshCw,
  CalendarDays,
  Clock,
  Package,
  Plus,
} from "lucide-react";
import AppForm from "./AppForm.jsx";
import { LoadingState } from "./OverlayDialog.jsx";
import { CaptureScreen } from "./DepartureCamera.jsx";
import { api } from "./api.js";
import { formatLiters } from "./water-volume.js";
import { waterComparison } from "./water-stock.js";
import { WaterFlow, WaterMenu } from "./water-reports.jsx";

export function createWaterControl({
  useApp,
  Header,
  Field,
  Submit,
  useResource,
}) {
  return function WaterControl() {
    const { act } = useApp(),
      [revision, setRevision] = useState(0),
      // The meter/photo draft must not be reset by another device's updates.
      // Saving still checks the authoritative baseline/catalog on the server.
      [info, error] = useResource("/water-control?revision=" + revision, {
        live: false,
      }),
      [draft, setDraft] = useState({}),
      [stockDraft, setStockDraft] = useState({}),
      [cameraMeter, setCameraMeter] = useState(null),
      [message, setMessage] = useState(""),
      [success, setSuccess] = useState("");
    const waiting = info && info.nextShiftDate > info.today;
    const activeMeter =
      !waiting && info?.meters.find((meter) => meter.id === cameraMeter);
    useEffect(() => {
      if (!success) return;
      const timer = setTimeout(() => setSuccess(""), 2000);
      return () => clearTimeout(timer);
    }, [success]);
    useEffect(() => {
      if (!info) return;
      setCameraMeter(null);
      setStockDraft(
        Object.fromEntries(
          info.stockProducts.map((p) => [p.productId, { closing: 0 }]),
        ),
      );
      setDraft(
        Object.fromEntries(
          info.meters.map((meter) => [
            meter.id,
            {
              opening:
                info.baseline.readings.find((r) => r.meterId === meter.id)
                  ?.value ?? "",
              closing: "",
              photo: "",
            },
          ]),
        ),
      );
    }, [info]);
    function update(meterId, key, value) {
      setSuccess("");
      setDraft((old) => ({
        ...old,
        [meterId]: { ...old[meterId], [key]: value },
      }));
    }
    function setStock(productId, updateQuantity) {
      setSuccess("");
      setStockDraft((old) => ({
        ...old,
        [productId]: { closing: updateQuantity(old[productId]?.closing) },
      }));
    }
    const complete = info?.meters.every((meter) => {
      const row = draft[meter.id];
      return (
        row &&
        [row.opening, row.closing].every(
          (value) =>
            value !== "" &&
            Number.isFinite(Number(value)) &&
            Number(value) >= 0 &&
            Number(value) <= 1000000000000,
        ) &&
        Number(row.closing) >= Number(row.opening)
      );
    });
    const closingStock = (info?.stockProducts || []).map((product) => ({
      ...product,
      qty: Number(stockDraft[product.productId]?.closing || 0),
    }));
    const openingStock =
      info?.baseline.stock ??
      closingStock.map((product) => ({ ...product, qty: 0 }));
    const comparison = complete
      ? waterComparison(
          info.meters.map((meter) => ({
            meterId: meter.id,
            liters:
              Number(draft[meter.id].closing) - Number(draft[meter.id].opening),
          })),
          info.salesGroups,
          openingStock,
          closingStock,
        )
      : null;
    return (
      <>
        <Header
          title="Kontrol air"
          icon={Droplets}
          back="other"
          className="rv-reports-header"
          filters={<WaterMenu current="record" />}
        >
          <button
            type="button"
            className="rv-header-button"
            aria-label="Muat ulang kontrol air"
            onClick={() => {
              setMessage("");
              setRevision((v) => v + 1);
            }}
          >
            <RefreshCw size={15} />
          </button>
        </Header>
        <main className="rv-body rv-feature rv-water-body">
          {(error || message) && (
            <p className="rv-error" role="alert">
              {error || message}
            </p>
          )}
          {!info && !error && <LoadingState />}
          {info && (
            <>
              <section
                className="rv-water-shift-selector"
                aria-label="Pilihan shift"
              >
                <Field
                  label={
                    <span>
                      <CalendarDays size={13} /> Tanggal shift
                    </span>
                  }
                >
                  <input
                    aria-label="Tanggal shift"
                    type="date"
                    value={info.nextShiftDate}
                    readOnly
                  />
                </Field>
                <Field
                  label={
                    <span>
                      <Clock size={13} /> Shift
                    </span>
                  }
                >
                  <select
                    aria-label="Nomor shift"
                    key={info.nextShiftDate + info.nextShiftNumber}
                    defaultValue={info.nextShiftNumber}
                  >
                    {[1, 2].map((number) => (
                      <option
                        key={number}
                        value={number}
                        disabled={number !== info.nextShiftNumber}
                      >
                        Shift {number}
                      </option>
                    ))}
                  </select>
                </Field>
              </section>
              {waiting && (
                <p className="rv-note rv-water-shift-status">
                  Kedua shift hari ini sudah ditutup. Pencatatan berikutnya
                  dibuka besok.
                </p>
              )}
              <AppForm
                className="rv-stack rv-water-form"
                validationDurationMs={2000}
                onSubmit={async (event) => {
                  event.preventDefault();
                  setMessage("");
                  if (waiting) return;
                  if (
                    !complete ||
                    info.meters.some((meter) => !draft[meter.id]?.photo)
                  ) {
                    setMessage(
                      "Lengkapi angka dan foto semua meteran sebelum menutup shift.",
                    );
                    return;
                  }
                  try {
                    await act(() =>
                      api("/water-control", {
                        method: "POST",
                        body: {
                          previousId: info.previous?.id ?? null,
                          shiftDate: info.nextShiftDate,
                          shiftNumber: info.nextShiftNumber,
                          stock: {
                            closing: closingStock,
                          },
                          readings: info.meters.map((meter) => ({
                            meterId: meter.id,
                            opening: Number(draft[meter.id].opening),
                            closing: Number(draft[meter.id].closing),
                            photo: draft[meter.id].photo,
                          })),
                        },
                      }),
                    );
                    setSuccess("Shift " + info.nextShiftNumber + " tersimpan.");
                    setRevision((v) => v + 1);
                  } catch (err) {
                    setMessage(err.message);
                  }
                }}
              >
                <fieldset
                  className="rv-water-panel rv-stack"
                  id="rv-water-meter-panel"
                  aria-label="Input laporan meteran air"
                  disabled={waiting}
                >
                  <legend className="rv-water-record-heading">
                    <Droplets size={15} /> Angka meteran
                  </legend>
                  {info.meters.map((meter) => (
                    <section className="rv-card rv-water-meter" key={meter.id}>
                      <div className="rv-two">
                        <Field
                          label={
                            <span className="rv-water-meter-caption">
                              <strong>{meter.name}</strong>
                              <small>Awal (L)</small>
                            </span>
                          }
                        >
                          {info.baseline.source !== "manual" ? (
                            <output aria-label={"Awal " + meter.name + " (L)"}>
                              {formatLiters(draft[meter.id]?.opening || 0)}
                            </output>
                          ) : (
                            <input
                              aria-label={"Awal " + meter.name + " (L)"}
                              type="number"
                              inputMode="decimal"
                              required
                              min="0"
                              max="1000000000000"
                              step="0.000001"
                              value={draft[meter.id]?.opening ?? ""}
                              placeholder="Angka awal"
                              onChange={(e) =>
                                update(meter.id, "opening", e.target.value)
                              }
                            />
                          )}
                        </Field>
                        <Field label="Akhir (L)">
                          <input
                            type="number"
                            inputMode="decimal"
                            required
                            min={draft[meter.id]?.opening || 0}
                            max="1000000000000"
                            step="0.000001"
                            aria-label={"Akhir " + meter.name + " (L)"}
                            placeholder="Angka akhir"
                            value={draft[meter.id]?.closing ?? ""}
                            onChange={(e) =>
                              update(meter.id, "closing", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        className="rv-water-photo"
                        aria-label={"Foto meteran " + meter.name}
                        aria-haspopup="dialog"
                        onClick={() => {
                          setMessage("");
                          setCameraMeter(meter.id);
                        }}
                      >
                        <Camera size={15} aria-hidden="true" />
                        {draft[meter.id]?.photo && (
                          <img
                            src={draft[meter.id].photo}
                            alt={"Pratinjau meteran " + meter.name}
                          />
                        )}
                      </button>
                    </section>
                  ))}
                </fieldset>
                <fieldset
                  className="rv-water-panel rv-stack"
                  disabled={waiting}
                >
                  <legend className="rv-water-record-heading">
                    <Package size={15} /> Stok sisa
                  </legend>
                  <div className="rv-card rv-water-stock">
                    {info.stockProducts.length ? (
                      [
                        { id: "ro", name: "RO" },
                        { id: "mineral", name: "Mineral" },
                      ].map((group) => {
                        const products = info.stockProducts.filter(
                          (product) => product.group === group.id,
                        );
                        if (!products.length) return null;
                        return (
                          <section
                            key={group.id}
                            className="rv-water-stock-group"
                            data-water-group={group.id}
                          >
                            <h3>{group.name}</h3>
                            <div className="rv-water-stock-grid">
                              {products.map((product) => (
                                <div key={product.productId}>
                                  <button
                                    type="button"
                                    className="rv-water-stock-add"
                                    aria-label={
                                      "Tambah satu unit " + product.name
                                    }
                                    onClick={() =>
                                      setStock(product.productId, (qty) =>
                                        Math.min(
                                          1000000,
                                          Math.max(
                                            0,
                                            Math.floor(Number(qty) || 0),
                                          ) + 1,
                                        ),
                                      )
                                    }
                                  >
                                    <span>{product.name}</span>
                                    <Plus size={12} aria-hidden="true" />
                                  </button>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    max="1000000"
                                    step="1"
                                    required
                                    aria-label={
                                      "Stok sisa " + product.name + " (unit)"
                                    }
                                    value={
                                      stockDraft[product.productId]?.closing ??
                                      0
                                    }
                                    onFocus={(e) => e.target.select()}
                                    onChange={(event) => {
                                      const value = event.currentTarget.value;
                                      setStock(product.productId, () => value);
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </section>
                        );
                      })
                    ) : (
                      <p className="rv-note">
                        Belum ada produk dengan kapasitas aktif.
                      </p>
                    )}
                  </div>
                  {comparison && (
                    <details className="rv-water-preview">
                      <summary>Perbandingan air</summary>
                      {comparison.map((group) => (
                        <WaterFlow key={group.group} group={group} />
                      ))}
                    </details>
                  )}
                </fieldset>
                <Submit disabled={waiting}>Tutup shift & simpan</Submit>
                {success && (
                  <div className="rv-water-success" role="status">
                    {success}
                    <a href="#waterreports">Lihat laporan shift</a>
                  </div>
                )}
              </AppForm>
            </>
          )}
        </main>
        {activeMeter && (
          <CaptureScreen
            title={"Foto meteran " + activeMeter.name}
            detail="Kontrol air"
            caption={activeMeter.name}
            photo={draft[activeMeter.id]?.photo}
            onUse={(photo) => update(activeMeter.id, "photo", photo)}
            onClose={() => setCameraMeter(null)}
          />
        )}
      </>
    );
  };
}
