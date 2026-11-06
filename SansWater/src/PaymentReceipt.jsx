import React, { useEffect, useRef, useState } from "react";
import {
  Banknote,
  Download,
  Phone,
  ReceiptText,
  UserRound,
  X,
} from "lucide-react";
import OverlayDialog from "./OverlayDialog.jsx";
import { isSanzBrand } from "./BrandWordmark.jsx";
import { dateLabel, money, timeLabel } from "./api.js";

const businessWhatsApp = "085222559970";
const bankNumber = "7167439335";
const bankHolder = "Saifannur";

export function ReceiptButton({ customer, onClick }) {
  return (
    <button
      type="button"
      className="rv-receipt-trigger"
      aria-label={"Nota pembayaran " + customer}
      onClick={onClick}
    >
      <ReceiptText size={14} aria-hidden="true" /> Nota
    </button>
  );
}

export function paymentLabels(methods = [], outstanding = false) {
  return [
    ...["Tunai", "QRIS"].filter((method) => methods.includes(method)),
    ...(outstanding ? ["Hutang"] : []),
  ].join(" · ");
}

export function ReceiptFooter({ depotName, outstanding }) {
  return (
    <footer className="rv-receipt-footer">
      {outstanding && (
        <div className="rv-receipt-bank">
          <span
            className="rv-receipt-bank-mark"
            role="img"
            aria-label="Bank Syariah Indonesia"
          >
            BSI
            <svg width="7" height="7" viewBox="0 0 10 10" aria-hidden="true">
              <path
                fill="#e68b27"
                d="M5 0l1.5 3.1L10 3.6 7.5 6.1 8.1 10 5 8.2 1.9 10l.6-3.9L0 3.6l3.5-.5Z"
              />
            </svg>
          </span>
          <div className="rv-receipt-bank-account">
            <strong>{bankNumber}</strong>
            <small>a.n. {bankHolder}</small>
          </div>
        </div>
      )}
      <div className="rv-statement-footer-brand">
        {isSanzBrand(depotName) ? (
          <div
            className="rv-receipt-brand-art"
            role="img"
            aria-label="Sanz Water · Depo Air Minum"
          >
            <span className="rv-receipt-brand-drop" aria-hidden="true" />
            <span className="rv-receipt-brand-wordmark" aria-hidden="true" />
          </div>
        ) : (
          <span>
            <b>{depotName}</b>
            <small>DEPO AIR MINUM</small>
          </span>
        )}
      </div>
      <p>Terima kasih atas kepercayaan Anda.</p>
      <a
        className="rv-receipt-contact"
        href={"https://wa.me/62" + businessWhatsApp.slice(1)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="rv-receipt-contact-icon">
          <Phone size={12} aria-hidden="true" />
        </span>
        <span>WhatsApp Sanz Water</span>
        <strong>{businessWhatsApp}</strong>
      </a>
    </footer>
  );
}

export default function PaymentReceipt({ receipt, depotName, onClose, error }) {
  const paper = useRef(null);
  const [image, setImage] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const debtPayment = receipt?.kind === "debt-payment";
  const paymentOnly = debtPayment || receipt?.kind === "payment";
  const request = receipt?.kind === "request";
  const title = debtPayment
    ? "Nota pembayaran hutang"
    : request
      ? "Nota pesanan"
      : "Nota pembayaran";
  const heading = request
    ? "RINCIAN PESANAN"
    : paymentOnly
      ? "RINCIAN PEMBAYARAN"
      : "RINCIAN TRANSAKSI";
  let content;
  const filename =
    receipt && "Nota-" + receipt.id.slice(0, 8).toUpperCase() + ".png";
  useEffect(() => {
    if (!receipt || !paper.current) return;
    const node = paper.current;
    let active = true;
    let url;
    setImage(null);
    async function renderImage() {
      try {
        await document.fonts.ready;
        const { toBlob } = await import("html-to-image");
        if (!active) return;
        const blob = await toBlob(node, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          preferredFontFormat: "woff2",
        });
        if (!blob) throw new Error("Gambar kosong");
        if (!active) return;
        url = URL.createObjectURL(blob);
        setImage({ receipt, url });
      } catch {
        if (active) setImage({ receipt, error: true });
      }
    }
    renderImage();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [receipt, depotName, attempt]);
  const readyImage = image?.receipt === receipt ? image : null;
  if (receipt) {
    const total = paymentOnly ? receipt.amount : receipt.total;
    const paid = paymentOnly ? receipt.amount : receipt.paid;
    const left = Math.max(0, total - paid);
    const status =
      left === 0
        ? paymentOnly
          ? "Diterima"
          : "Lunas"
        : request
          ? paid > 0
            ? "Belum lunas"
            : "Belum bayar"
          : "Hutang";
    const methods = paymentLabels(
      paymentOnly ? [receipt.method] : receipt.methods,
    );
    const paidMethod = methods && (
      <span className="rv-receipt-paid-method">
        <Banknote size={13} aria-hidden="true" /> {methods}
      </span>
    );
    const timestamp =
      receipt.recorded_at || receipt.created_at || receipt.received_at;
    const documentDate = paymentOnly
      ? timestamp
      : receipt.received_at || timestamp;
    const customer = [receipt.customer_code, receipt.customer_name]
      .filter(Boolean)
      .join(" · ");
    const lines = paymentOnly
      ? receipt.allocations.map((allocation) => ({
          label: "Tagihan " + dateLabel(allocation.recorded_at),
          amount: allocation.amount,
        }))
      : receipt.items.map((line) => ({
          label:
            line.qty + " × " + line.name + (line.mode ? " · " + line.mode : ""),
          amount: line.qty * line.price,
        }));
    const entries = [
      ...lines,
      ...(receipt.discount
        ? [{ label: "Diskon", amount: -receipt.discount }]
        : []),
      ...(receipt.shipping
        ? [{ label: "Ongkir", amount: receipt.shipping, add: true }]
        : []),
    ];
    const totalLabel = paymentOnly ? "Pembayaran diterima" : "Total pesanan";
    content = (
      <article className="rv-statement-paper" ref={paper}>
        <header className="rv-statement-hero">
          <div className="rv-statement-heading">
            <span>{heading}</span>
            <h2>
              {title}
              <span>{status}</span>
            </h2>
            <div className="rv-receipt-header-meta">
              <time className="rv-receipt-date" dateTime={documentDate}>
                {new Intl.DateTimeFormat("id-ID", {
                  timeZone: "Asia/Jakarta",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date(documentDate))}
                {paymentOnly && " · " + timeLabel(documentDate) + " WIB"}
              </time>
              {receipt.actor && (
                <span className="rv-receipt-actor">
                  <UserRound size={12} aria-hidden="true" />
                  {paymentOnly ? "Diterima oleh " : "Oleh "}
                  {receipt.actor}
                </span>
              )}
            </div>
          </div>
        </header>
        <div className="rv-statement-content">
          <div className="rv-statement-recipient">
            <div>
              <small>PELANGGAN</small>
              <strong>{customer}</strong>
            </div>
          </div>
          {entries.length > 0 && (
            <ul className="rv-receipt-items" aria-label="Rincian nota">
              {entries.map(({ label, amount, add }, index) => (
                <li key={index}>
                  <div>
                    <span>{label}</span>
                    <span>
                      {amount < 0 ? "−" : add ? "+" : ""}
                      {money(Math.abs(amount))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <dl className="rv-receipt-details">
            <div className="rv-receipt-total">
              <dt>
                {totalLabel}
                {paymentOnly && paidMethod}
              </dt>
              <dd>{money(total)}</dd>
            </div>
            {!paymentOnly && paid > 0 && (
              <div>
                <dt>Dibayar{paidMethod}</dt>
                <dd>{money(paid)}</dd>
              </div>
            )}
            {paid > 0 && left > 0 && (
              <div>
                <dt>{request ? "Sisa pembayaran" : "Sisa hutang"}</dt>
                <dd>{money(left)}</dd>
              </div>
            )}
          </dl>
          <ReceiptFooter depotName={depotName} outstanding={left > 0} />
        </div>
      </article>
    );
  }
  return (
    <OverlayDialog
      className="rv-debt-statement-dialog rv-payment-receipt"
      aria-label={title}
      onClose={onClose}
    >
      <div className="rv-statement-toolbar">
        {readyImage?.url ? (
          <a
            className="rv-statement-download"
            href={readyImage.url}
            download={filename}
          >
            <Download size={14} /> Unduh gambar
          </a>
        ) : (
          <button
            type="button"
            className="rv-statement-download"
            disabled={!readyImage?.error}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <Download size={14} /> Unduh gambar
          </button>
        )}
        <button
          type="button"
          className="rv-icon-button"
          aria-label="Tutup nota"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {readyImage?.error && (
        <p className="rv-statement-save-error" role="alert">
          Gambar nota gagal dibuat. Ketuk Unduh gambar untuk mencoba lagi.
        </p>
      )}
      {content || (
        <p className="rv-statement-loading" role={error ? "alert" : "status"}>
          {error || "Menyiapkan nota…"}
        </p>
      )}
    </OverlayDialog>
  );
}
