import React, { useEffect, useRef, useState } from "react";
import {
  Droplets,
  Camera,
  RefreshCw,
  History,
  Package,
  Minus,
  Plus,
} from "lucide-react";
import AppForm from "./AppForm.jsx";
import { api, can, dateLabel, timeLabel, imageFile } from "./api.js";
import { formatLiters } from "./water-volume.js";
import { stockLiters, waterComparison } from "./water-stock.js";

export function createWaterControl({
  useApp,
  Header,
  Field,
  Submit,
  PhotoButton,
  useResource,
}) {
  return function WaterControl() {
    const { data, act } = useApp(),
      [revision, setRevision] = useState(0),
      // The meter/photo draft must not be reset by another device's updates.
      // Saving still checks the authoritative baseline/catalog on the server.
      [info, error] = useResource("/water-control?revision=" + revision, {
        live: false,
      }),
      [draft, setDraft] = useState({}),
      [stockDraft, setStockDraft] = useState({}),
      [view, setView] = useState("meter"),
      [stockGroup, setStockGroup] = useState("ro"),
      [photoBusy, setPhotoBusy] = useState(0),
      [message, setMessage] = useState("");
    const meterPanel = useRef(null);
    useEffect(() => {
      if (!info) return;
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
      setDraft((old) => ({
        ...old,
        [meterId]: { ...old[meterId], [key]: value },
      }));
    }
    function setStock(productId, value) {
      setStockDraft((old) => ({
        ...old,
        [productId]: { closing: value },
      }));
    }
    function adjustStock(productId, delta) {
      setStockDraft((old) => ({
        ...old,
        [productId]: {
          closing: Math.max(
            0,
            Math.min(1000000, Number(old[productId]?.closing || 0) + delta),
          ),
        },
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
    const selectedStock = (info?.stockProducts || []).filter(
      (p) =>
        stockDraft[p.productId]?.closing === "" ||
        (stockDraft[p.productId]?.closing != null &&
          Number(stockDraft[p.productId].closing) !== 0),
    );
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
        <Header title="Kontrol air" icon={Droplets} back="other">
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
          {!info && !error && <p className="rv-note">Memuat kontrol air…</p>}
          {info && (
            <>
              <section className="rv-report-water">
                <div>
                  <Droplets size={17} />
                  <span>Air terjual hari ini</span>
                  <strong>{formatLiters(info.daily.liters, 3)}</strong>
                </div>
                {info.daily.legacyInvoices > 0 && (
                  <small>
                    {info.daily.legacyInvoices} transaksi lama belum memiliki
                    data kapasitas.
                  </small>
                )}
              </section>
              {can(data.user, "waterControl") && (
                <>
                  <div
                    className="rv-water-tabs"
                    role="group"
                    aria-label="Bagian input kontrol air"
                  >
                    <button
                      type="button"
                      aria-pressed={view === "meter"}
                      aria-controls="rv-water-meter-panel"
                      onClick={() => setView("meter")}
                    >
                      <Droplets size={16} /> Laporan meteran
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "stock"}
                      aria-controls="rv-water-stock-panel"
                      onClick={() => setView("stock")}
                    >
                      <Package size={16} /> Input stok sisa
                    </button>
                  </div>
                  <AppForm
                    className="rv-stack rv-water-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setMessage("");
                      if (view === "meter") {
                        setView("stock");
                        return;
                      }
                      if (
                        !complete ||
                        info.meters.some((meter) => !draft[meter.id]?.photo)
                      ) {
                        setView("meter");
                        setMessage(
                          "Lengkapi angka dan foto semua meteran sebelum menyimpan laporan harian.",
                        );
                        requestAnimationFrame(() =>
                          meterPanel.current
                            ?.querySelector("input:invalid")
                            ?.focus(),
                        );
                        return;
                      }
                      try {
                        await act(() =>
                          api("/water-control", {
                            method: "POST",
                            body: {
                              previousId: info.previous?.id ?? null,
                              day: info.today,
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
                        setRevision((v) => v + 1);
                      } catch (err) {
                        setMessage(err.message);
                      }
                    }}
                  >
                    <fieldset
                      ref={meterPanel}
                      className="rv-water-panel rv-stack"
                      id="rv-water-meter-panel"
                      aria-label="Input laporan meteran air"
                      hidden={view !== "meter"}
                      disabled={view !== "meter"}
                    >
                      <div className="rv-section-heading">
                        <h3>Laporan meteran air</h3>
                        <span className="rv-note">Semua angka dalam liter</span>
                      </div>
                      <p className="rv-note rv-water-help">
                        {info.baseline.source === "previous-day"
                          ? "Angka awal dari meteran akhir " +
                            dateLabel(info.baseline.date + "T00:00:00+07:00") +
                            " (kemarin). Tetap sama sepanjang hari ini."
                          : info.baseline.source === "today-opening"
                            ? "Angka awal memakai angka awal yang sudah dicatat hari ini. Laporan kemarin belum tersedia."
                            : "Laporan kemarin belum tersedia. Isi angka awal sekali untuk hari ini, lalu angka akhir hari ini."}
                      </p>
                      {info.meters.map((meter) => (
                        <section
                          className="rv-card rv-water-meter"
                          key={meter.id}
                        >
                          <h4>
                            <Droplets size={15} /> Meteran {meter.name}
                          </h4>
                          <div className="rv-two">
                            <Field label={"Awal " + meter.name + " (L)"}>
                              {info.baseline.source !== "manual" ? (
                                <output>
                                  {formatLiters(draft[meter.id]?.opening || 0)}
                                </output>
                              ) : (
                                <input
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
                            <Field label={"Akhir " + meter.name + " (L)"}>
                              <input
                                type="number"
                                inputMode="decimal"
                                required
                                min={draft[meter.id]?.opening || 0}
                                max="1000000000000"
                                step="0.000001"
                                placeholder="Angka akhir"
                                value={draft[meter.id]?.closing ?? ""}
                                onChange={(e) =>
                                  update(meter.id, "closing", e.target.value)
                                }
                              />
                            </Field>
                          </div>
                          <label className="rv-water-photo">
                            <input
                              key={info.previous?.id ?? "first"}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              aria-label={"Foto meteran " + meter.name}
                              required
                              onChange={async (e) => {
                                const file = e.target.files[0];
                                if (!file) return;
                                setMessage("");
                                setPhotoBusy((v) => v + 1);
                                try {
                                  update(
                                    meter.id,
                                    "photo",
                                    await imageFile(file),
                                  );
                                } catch (err) {
                                  setMessage(err.message);
                                  e.target.value = "";
                                  update(meter.id, "photo", "");
                                } finally {
                                  setPhotoBusy((v) => v - 1);
                                }
                              }}
                            />
                            <Camera size={15} />{" "}
                            {draft[meter.id]?.photo
                              ? "Foto terpilih · ganti"
                              : "Foto meteran " + meter.name}
                            {draft[meter.id]?.photo && (
                              <img
                                src={draft[meter.id].photo}
                                alt={"Pratinjau meteran " + meter.name}
                              />
                            )}
                          </label>
                        </section>
                      ))}
                    </fieldset>
                    <fieldset
                      className="rv-water-panel rv-stack"
                      id="rv-water-stock-panel"
                      aria-label="Input stok sisa"
                      hidden={view !== "stock"}
                      disabled={view !== "stock"}
                    >
                      <section
                        className="rv-card rv-water-stock"
                        aria-labelledby="rv-water-stock-title"
                      >
                        <h3 id="rv-water-stock-title">Stok sisa hari ini</h3>
                        <p className="rv-note">
                          Pilih produk yang sudah terisi, tetapi belum
                          diserahkan ke pelanggan. Produk yang tidak dipilih
                          dihitung 0.
                        </p>
                        {!info.stockProducts.length && (
                          <p className="rv-note">
                            Aktifkan kapasitas pada produk RO atau Mineral agar
                            muncul di sini.
                          </p>
                        )}
                        {!!info.stockProducts.length && (
                          <>
                            <div
                              className="rv-category-chips"
                              role="group"
                              aria-label="Jenis air stok sisa"
                            >
                              {[
                                { id: "ro", name: "RO" },
                                { id: "mineral", name: "Mineral" },
                              ].map((group) => (
                                <button
                                  type="button"
                                  key={group.id}
                                  aria-pressed={stockGroup === group.id}
                                  onClick={() => setStockGroup(group.id)}
                                >
                                  {group.name}
                                </button>
                              ))}
                            </div>
                            <div className="rv-product-tiles">
                              {info.stockProducts
                                .filter((p) => p.group === stockGroup)
                                .map((product) => (
                                  <button
                                    type="button"
                                    className="rv-product-pick"
                                    key={product.productId}
                                    data-picked={
                                      Number(
                                        stockDraft[product.productId]?.closing,
                                      ) > 0
                                    }
                                    aria-label={
                                      "Pilih stok sisa " + product.name
                                    }
                                    onClick={() =>
                                      adjustStock(product.productId, 1)
                                    }
                                  >
                                    <span>
                                      <strong>{product.name}</strong>
                                      <small>
                                        {formatLiters(product.capacityLiters)} /
                                        unit
                                        {product.carried
                                          ? " · stok sebelumnya"
                                          : ""}
                                      </small>
                                    </span>
                                    <span className="rv-product-pick-count">
                                      {stockDraft[product.productId]?.closing ||
                                        "+"}
                                    </span>
                                  </button>
                                ))}
                            </div>
                            {!info.stockProducts.some(
                              (p) => p.group === stockGroup,
                            ) && (
                              <p className="rv-note">
                                Belum ada produk{" "}
                                {stockGroup === "ro" ? "RO" : "Mineral"} dengan
                                kapasitas aktif.
                              </p>
                            )}
                            <section
                              className="rv-selected-products rv-water-selected"
                              aria-label="Rincian stok sisa"
                            >
                              <div className="rv-selected-heading">
                                <h4>Rincian stok sisa</h4>
                                <span>
                                  {closingStock.reduce(
                                    (sum, p) => sum + p.qty,
                                    0,
                                  )}{" "}
                                  unit
                                </span>
                              </div>
                              {!selectedStock.length && (
                                <p className="rv-note">
                                  Belum ada stok sisa dipilih. Jika habis,
                                  langsung simpan dengan jumlah 0.
                                </p>
                              )}
                              {selectedStock.map((product) => (
                                <div
                                  className="rv-selected-product"
                                  key={product.productId}
                                >
                                  <div className="rv-selected-line">
                                    <span>
                                      <strong>{product.name}</strong>
                                      <small>
                                        {formatLiters(product.capacityLiters)} /
                                        unit
                                      </small>
                                    </span>
                                    <div className="rv-quantity-control">
                                      <button
                                        type="button"
                                        aria-label={
                                          "Kurangi stok sisa " + product.name
                                        }
                                        onClick={() =>
                                          adjustStock(product.productId, -1)
                                        }
                                      >
                                        <Minus />
                                      </button>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min="0"
                                        max="1000000"
                                        step="1"
                                        required
                                        aria-label={"Stok sisa " + product.name}
                                        value={
                                          stockDraft[product.productId]
                                            ?.closing ?? 0
                                        }
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) =>
                                          setStock(
                                            product.productId,
                                            e.target.value,
                                          )
                                        }
                                      />
                                      <button
                                        type="button"
                                        aria-label={
                                          "Tambah stok sisa " + product.name
                                        }
                                        onClick={() =>
                                          adjustStock(product.productId, 1)
                                        }
                                      >
                                        <Plus />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </section>
                          </>
                        )}
                        <div className="rv-water-stock-totals">
                          {[
                            { group: "ro", name: "RO" },
                            { group: "mineral", name: "Mineral" },
                          ].map((group) => (
                            <span key={group.group}>
                              {group.name}
                              <strong>
                                {formatLiters(
                                  stockLiters(closingStock, group.group),
                                  3,
                                )}
                              </strong>
                              <small>
                                Awal{" "}
                                {formatLiters(
                                  stockLiters(openingStock, group.group),
                                  3,
                                )}
                              </small>
                            </span>
                          ))}
                        </div>
                        <p className="rv-note">
                          {info.baseline.stock
                            ? "Stok awal otomatis; nilainya tetap sama sepanjang hari ini."
                            : "Belum ada catatan stok sebelumnya; stok awal dihitung 0."}{" "}
                          Sisa hari ini menjadi stok awal besok.
                        </p>
                      </section>
                      <section className="rv-card rv-water-compare">
                        <h3>Perbandingan hari ini</h3>
                        <small>
                          Sejak {dateLabel(info.start)} ·{" "}
                          {timeLabel(info.start)}
                        </small>
                        <p className="rv-note">
                          RO = RO 1 + RO 2. Perbandingan memakai air diserahkan
                          + stok sisa − stok awal.
                        </p>
                        {(
                          comparison || [
                            { group: "ro", name: "RO" },
                            { group: "mineral", name: "Mineral" },
                          ]
                        ).map((group) => (
                          <div
                            className="rv-water-group-compare"
                            key={group.group}
                          >
                            <strong>{group.name}</strong>
                            <dl>
                              <div>
                                <dt>Meteran</dt>
                                <dd>
                                  {comparison
                                    ? formatLiters(group.usageLiters, 3)
                                    : "—"}
                                </dd>
                              </div>
                              <div>
                                <dt>Kebutuhan air</dt>
                                <dd>
                                  {comparison
                                    ? formatLiters(group.expectedLiters, 3)
                                    : "—"}
                                </dd>
                              </div>
                              <div>
                                <dt>Selisih</dt>
                                <dd>
                                  {comparison
                                    ? formatLiters(group.differenceLiters, 3)
                                    : "—"}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                        {info.salesGroups.ungroupedLiters > 0 && (
                          <p className="rv-note">
                            {formatLiters(info.salesGroups.ungroupedLiters, 3)}{" "}
                            penjualan belum dikelompokkan sebagai RO atau
                            Mineral.
                          </p>
                        )}
                        {info.sales.legacyInvoices > 0 && (
                          <p className="rv-note">
                            Perbandingan belum lengkap:{" "}
                            {info.sales.legacyInvoices} transaksi tanpa data
                            kapasitas.
                          </p>
                        )}
                      </section>
                    </fieldset>
                    <Submit disabled={photoBusy > 0}>
                      {photoBusy
                        ? "Menyiapkan foto…"
                        : view === "meter"
                          ? "Lanjut ke stok sisa"
                          : "Simpan laporan harian"}
                    </Submit>
                    <p className="rv-note rv-water-save-note">
                      Meteran dan stok sisa disimpan bersama dalam satu laporan
                      harian.
                    </p>
                  </AppForm>
                </>
              )}
              <section className="rv-stack rv-water-history">
                <h3>
                  <History size={16} /> Laporan terakhir
                </h3>
                {!info.history.length && (
                  <p className="rv-note">Belum ada catatan meteran.</p>
                )}
                {info.history.map((check) => (
                  <article className="rv-card rv-water-check" key={check.id}>
                    <header>
                      <strong>
                        {dateLabel(check.created_at)} ·{" "}
                        {timeLabel(check.created_at)}
                      </strong>
                      <span>{check.actor}</span>
                    </header>
                    {check.comparison ? (
                      <>
                        {check.comparison.map((group) => (
                          <div
                            className="rv-water-history-group"
                            key={group.group}
                          >
                            <strong>{group.name}</strong>
                            <span>
                              Meteran {formatLiters(group.usageLiters, 3)}
                            </span>
                            <span>
                              Sisa {formatLiters(group.closingLiters, 3)}
                            </span>
                            <span>
                              Selisih {formatLiters(group.differenceLiters, 3)}
                            </span>
                          </div>
                        ))}
                        {check.stock.closing.some((row) => row.qty > 0) && (
                          <p className="rv-note">
                            Stok sisa hari ini:{" "}
                            {check.stock.closing
                              .filter((row) => row.qty > 0)
                              .map((row) => row.name + " × " + row.qty)
                              .join(" · ")}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="rv-water-check-totals">
                        <span>
                          Meteran <b>{formatLiters(check.usage_liters, 3)}</b>
                        </span>
                        <span>
                          Diserahkan{" "}
                          <b>{formatLiters(check.sales_liters, 3)}</b>
                        </span>
                        <span>
                          Selisih{" "}
                          <b>
                            {formatLiters(
                              check.usage_liters - check.sales_liters,
                              3,
                            )}
                          </b>
                        </span>
                      </div>
                    )}
                    {check.legacy_invoices > 0 && (
                      <small className="rv-note">
                        {check.legacy_invoices} transaksi belum memiliki data
                        kapasitas.
                      </small>
                    )}
                    <div className="rv-water-check-photos">
                      {check.readings.map((r) => (
                        <span key={r.meterId}>
                          <span>
                            {r.name}: {formatLiters(r.opening)} →{" "}
                            {formatLiters(r.closing)}
                          </span>
                          <PhotoButton
                            id={r.photoId}
                            label={
                              "Foto " +
                              r.name +
                              " · " +
                              dateLabel(check.created_at)
                            }
                          />
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}
        </main>
      </>
    );
  };
}
