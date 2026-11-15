import React, { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";

export default function ReceiptImageActions({
  paper,
  snapshot,
  filename,
  title,
  depotName,
}) {
  const [rendered, setRendered] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [shareMessage, setShareMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!snapshot || !paper.current) return;
    const node = paper.current;
    let active = true;
    let url;
    setRendered(null);
    setShareMessage("");
    async function prepare() {
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
        const file = new File([blob], filename, { type: "image/png" });
        url = URL.createObjectURL(file);
        setRendered({ snapshot, file, url });
      } catch {
        if (active) setRendered({ snapshot, error: true });
      }
    }
    prepare();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [paper, snapshot, filename, depotName, attempt]);
  const image = rendered?.snapshot === snapshot ? rendered : null;
  async function share() {
    if (!image?.file || sharing) return;
    setShareMessage("");
    const payload = { files: [image.file] };
    if (!navigator.share || !navigator.canShare?.(payload)) {
      setShareMessage(
        "Perangkat ini belum mendukung berbagi gambar langsung. Pilih Unduh gambar.",
      );
      return;
    }
    setSharing(true);
    try {
      await navigator.share({ ...payload, title });
    } catch (error) {
      if (error.name !== "AbortError")
        setShareMessage(
          "Nota belum dapat dibagikan. Coba lagi atau pilih Unduh gambar.",
        );
    } finally {
      setSharing(false);
    }
  }
  return (
    <div className="rv-receipt-image-actions">
      <div>
        <button
          type="button"
          className="rv-statement-download"
          onClick={share}
          disabled={!image?.file || sharing}
        >
          <Share2 size={14} aria-hidden="true" /> Bagikan nota
        </button>
        {image?.url ? (
          <a
            className="rv-statement-download"
            href={image.url}
            download={filename}
          >
            <Download size={14} aria-hidden="true" /> Unduh gambar
          </a>
        ) : (
          <button
            type="button"
            className="rv-statement-download"
            disabled={!image?.error}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <Download size={14} aria-hidden="true" />{" "}
            {image?.error ? "Coba lagi" : "Unduh gambar"}
          </button>
        )}
      </div>
      {(shareMessage || image?.error) && (
        <p className="rv-statement-save-error" role="status">
          {shareMessage || "Gambar nota gagal dibuat. Ketuk Coba lagi."}
        </p>
      )}
    </div>
  );
}
