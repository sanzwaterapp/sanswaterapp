import React, { useRef, useState } from "react";
import { X, CheckCircle2, Download } from "lucide-react";
import { ReceiptFooter } from "./PaymentReceipt.jsx";
import OverlayDialog, { LoadingState } from "./OverlayDialog.jsx";
import { money, timeLabel } from "./api.js";
import { debtStatement } from "./debt-statement.js";

const fullDate = (value) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

export default function DebtStatement({
  customer,
  depotName,
  useResource,
  onClose,
}) {
  const [retry, setRetry] = useState(0);
  const paper = useRef(null);
  const [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [exported, setExported] = useState("");
  const [rows, error] = useResource(
    "/customers/" + customer.id + "/debts?statement=" + retry,
  );
  const [issuedAt] = useState(() => new Date().toISOString());
  const statement = rows ? debtStatement(rows) : null;
  async function saveImage() {
    if (!paper.current || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await document.fonts.ready;
      const { toPng } = await import("html-to-image");
      const url = await toPng(paper.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        preferredFontFormat: "woff2",
      });
      const link = document.createElement("a");
      link.download =
        "Nota-utang-" +
        (customer.code || customer.name).replace(/[^a-zA-Z0-9_-]/g, "-") +
        ".png";
      link.href = url;
      link.click();
      setExported(url);
    } catch {
      setSaveError(
        "Gambar belum dapat disimpan. Coba lagi atau ambil screenshot nota.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <OverlayDialog
      className="rv-debt-statement-dialog"
      onClose={onClose}
      aria-labelledby="rv-statement-title"
    >
      <div className="rv-statement-toolbar">
        <button
          type="button"
          className="rv-statement-download"
          onClick={saveImage}
          disabled={!statement || saving}
        >
          <Download size={14} />
          {saving ? "Menyiapkan…" : "Simpan gambar"}
        </button>
        <button
          type="button"
          className="rv-icon-button"
          aria-label="Tutup nota utang"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {saveError && (
        <p className="rv-statement-save-error" role="alert">
          {saveError}
        </p>
      )}
      {exported && (
        <div className="rv-statement-export-ready" role="status">
          Gambar nota siap.{" "}
          <a
            href={exported}
            download={"Nota-utang-" + (customer.code || "pelanggan") + ".png"}
          >
            Unduh PNG
          </a>
        </div>
      )}
      {error ? (
        <div className="rv-statement-loading">
          <p role="alert" className="rv-error">
            {error}
          </p>
          <button
            className="rv-secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Coba lagi
          </button>
        </div>
      ) : !statement ? (
        <LoadingState compact />
      ) : (
        <article
          ref={paper}
          className="rv-statement-paper"
          aria-label={"Nota utang " + customer.name}
        >
          <header className="rv-statement-hero">
            <div className="rv-statement-heading">
              <span>RINCIAN TAGIHAN PELANGGAN</span>
              <h2 id="rv-statement-title">
                Nota utang
                <span>
                  {statement.remaining > 0 ? "Belum dibayar" : "Lunas"}
                </span>
              </h2>
            </div>
          </header>
          <div className="rv-statement-content">
            <div className="rv-statement-recipient">
              <div>
                <small>KEPADA</small>
                <strong>{customer.name}</strong>
                <span>{customer.code || "Pelanggan"}</span>
              </div>
              <div className="rv-statement-issued">
                <small>DIPERBARUI</small>
                <time dateTime={issuedAt}>{fullDate(issuedAt)}</time>
                <span>{timeLabel(issuedAt)} WIB</span>
              </div>
            </div>
            <div className="rv-statement-total">
              <span>
                Total belum dibayar
                <small>{statement.bills.length} tagihan belum lunas</small>
              </span>
              <strong>{money(statement.remaining)}</strong>
            </div>
            <ul className="rv-statement-bills" role="list">
              {statement.bills.map((bill) => (
                <li
                  className="rv-statement-bill"
                  key={bill.id}
                  aria-label={"Tagihan " + fullDate(bill.recorded_at)}
                >
                  <div className="rv-statement-bill-main">
                    <time dateTime={bill.debt_at || bill.recorded_at}>
                      {fullDate(bill.debt_at || bill.recorded_at)}
                    </time>
                    <strong>{money(bill.left)}</strong>
                  </div>
                  <p className="rv-statement-product-line">
                    {bill.items
                      .map(
                        (item) =>
                          item.qty +
                          " " +
                          item.name +
                          (item.mode &&
                          !["Isi ulang", "Beli"].includes(item.mode)
                            ? " (" + item.mode + ")"
                            : "") +
                          " × " +
                          money(item.price),
                      )
                      .join(" · ")}
                    {(bill.shipping > 0 || bill.discount > 0) && (
                      <span className="rv-statement-meta-line">
                        {" · " +
                          [
                            bill.shipping > 0
                              ? "Ongkir " + money(bill.shipping)
                              : "",
                            bill.discount > 0
                              ? "Diskon −" + money(bill.discount)
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                      </span>
                    )}
                  </p>
                  {bill.paid > 0 && (
                    <p className="rv-statement-paid-line">
                      Dibayar {money(bill.paid)} dari {money(bill.total)}
                    </p>
                  )}
                </li>
              ))}
              {!statement.bills.length && (
                <li className="rv-statement-clear">
                  <CheckCircle2 size={22} />
                  Semua tagihan sudah lunas.
                </li>
              )}
            </ul>
            <ReceiptFooter
              depotName={depotName}
              outstanding={statement.remaining > 0}
            />
          </div>
        </article>
      )}
    </OverlayDialog>
  );
}
