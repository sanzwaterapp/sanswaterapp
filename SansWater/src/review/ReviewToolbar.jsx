import AppForm from "../AppForm.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  MessageSquare,
  Copy,
  X,
  Check,
  FlaskConical,
  Trash2,
} from "lucide-react";

const storageKey = "depot.ui-feedback.v1";
function readNotes() {
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(rows)
      ? rows
          .filter(
            (r) => typeof r.comment === "string" && typeof r.page === "string",
          )
          .slice(-50)
      : [];
  } catch {
    return [];
  }
}
function describe(element) {
  const target =
    element.closest(
      "button,input,select,textarea,h2,h3,.rv-identity,.rv-card,.rv-order,.rv-trip,.rv-customer-button",
    ) || element;
  const label = (
    target.getAttribute("aria-label") ||
    target.textContent ||
    target.tagName
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const classes = [...target.classList]
    .filter((c) => c.startsWith("rv-"))
    .slice(0, 3);
  return {
    target,
    label,
    selector: target.id
      ? "#" + CSS.escape(target.id)
      : target.tagName.toLowerCase() +
        classes.map((c) => "." + CSS.escape(c)).join(""),
  };
}
export function ReviewToolbar({ page, simulation, owner }) {
  const annotation = document.oai?.annotation,
    native =
      typeof annotation?.toggle === "function" &&
      typeof annotation?.isActive === "function";
  const [nativeActive, setNativeActive] = useState(
      () => native && annotation.isActive(),
    ),
    [picking, setPicking] = useState(false),
    [selection, setSelection] = useState(null),
    [draft, setDraft] = useState(null),
    [comment, setComment] = useState(""),
    [notes, setNotes] = useState(readNotes),
    [list, setList] = useState(false),
    [copied, setCopied] = useState(false),
    [copyText, setCopyText] = useState("");
  const dialog = useRef(),
    start = useRef();
  useEffect(() => {
    if (!native) return;
    const handler = (e) => setNativeActive(e.detail.active);
    document.addEventListener("oaiannotationmodechange", handler);
    return () =>
      document.removeEventListener("oaiannotationmodechange", handler);
  }, [native]);
  useEffect(() => {
    setPicking(false);
    setSelection(null);
    setDraft(null);
  }, [page]);
  useEffect(() => {
    if (draft || list) dialog.current?.showModal();
    else dialog.current?.close();
  }, [!!draft, list]);
  useEffect(() => {
    if (!picking) return;
    const blocked = (e) => e.target.closest("[data-review-ui]");
    const point = (e) => {
      if (blocked(e)) return;
      const item = describe(e.target),
        rect = item.target.getBoundingClientRect();
      setSelection({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        label: item.label,
        selector: item.selector,
      });
    };
    const down = (e) => {
      if (blocked(e)) return;
      e.preventDefault();
      e.stopPropagation();
      start.current = { x: e.clientX, y: e.clientY, ...describe(e.target) };
    };
    const move = (e) => {
      if (start.current) {
        setSelection({
          x: Math.min(e.clientX, start.current.x),
          y: Math.min(e.clientY, start.current.y),
          width: Math.abs(e.clientX - start.current.x),
          height: Math.abs(e.clientY - start.current.y),
          label: start.current.label,
          selector: start.current.selector,
        });
      } else point(e);
    };
    const click = (e) => {
      if (blocked(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const item = start.current || {
          x: e.clientX,
          y: e.clientY,
          ...describe(e.target),
        },
        rect = item.target.getBoundingClientRect(),
        dragged =
          Math.abs(e.clientX - item.x) > 8 || Math.abs(e.clientY - item.y) > 8;
      const region = dragged
        ? {
            x: Math.min(e.clientX, item.x),
            y: Math.min(e.clientY, item.y),
            width: Math.abs(e.clientX - item.x),
            height: Math.abs(e.clientY - item.y),
          }
        : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      setDraft({
        ...region,
        label: item.label,
        selector: item.selector,
        page,
        viewport: window.innerWidth,
      });
      setComment("");
      setPicking(false);
      start.current = null;
    };
    const escape = (e) => {
      if (e.key === "Escape") {
        setPicking(false);
        setSelection(null);
        start.current = null;
      }
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [picking, page]);
  function toggle() {
    if (native) {
      try {
        const result = annotation.toggle(!annotation.isActive());
        if (result?.accepted) {
          setNativeActive(annotation.isActive());
          return;
        }
      } catch {}
    }
    setPicking((v) => !v);
    setSelection(null);
    setList(false);
  }
  function save(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    const row = {
        ...draft,
        id: crypto.randomUUID(),
        comment: comment.trim(),
        createdAt: new Date().toISOString(),
      },
      next = [...notes, row].slice(-50);
    setNotes(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
    setDraft(null);
    setSelection(null);
    setList(true);
  }
  async function copy() {
    const content = notes
      .map(
        (n, i) =>
          `${i + 1}. Halaman: ${n.page}\nArea: ${n.label}\nTarget: ${n.selector}\nPosisi: x ${Math.round(n.x)}, y ${Math.round(n.y)}, ${Math.round(n.width)} × ${Math.round(n.height)} px; lebar layar ${n.viewport}px\nPerubahan: ${n.comment}`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      setCopyText(content);
    }
  }
  if (!owner) return null;
  return (
    <>
      <div
        className="review-toolbar"
        data-review-ui="true"
        data-native-annotation={String(native)}
      >
        <span>
          {simulation ? (
            <>
              <FlaskConical size={13} />
              Data simulasi
            </>
          ) : (
            "Live view"
          )}
        </span>
        <button
          type="button"
          aria-label="Tandai tampilan"
          aria-pressed={picking || nativeActive}
          onClick={toggle}
        >
          <MousePointer2 size={14} />
          {picking
            ? "Batal menandai"
            : nativeActive
              ? "Penunjuk aktif"
              : "Tandai"}
        </button>
        <button
          type="button"
          aria-label={"Catatan area edit, " + notes.length}
          onClick={() => {
            setList(!list);
            setDraft(null);
            setCopied(false);
          }}
        >
          <MessageSquare size={14} />
          {notes.length || "Catatan"}
        </button>
      </div>
      {picking && (
        <div className="review-instruction" data-review-ui="true">
          Klik bagian atau tarik area · Esc untuk batal
        </div>
      )}
      {selection && (picking || draft) && (
        <div
          className="review-selection"
          aria-hidden="true"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        />
      )}
      <dialog
        className="review-dialog"
        data-review-ui="true"
        ref={dialog}
        onClose={() => {
          setDraft(null);
          setList(false);
          setSelection(null);
        }}
      >
        <div className="review-dialog-heading">
          <strong>{draft ? "Tandai perubahan" : "Catatan tampilan"}</strong>
          <button
            type="button"
            aria-label="Tutup catatan"
            onClick={() => dialog.current.close()}
          >
            <X size={17} />
          </button>
        </div>
        {draft ? (
          <AppForm onSubmit={save}>
            <small>
              {draft.page} · {draft.label}
            </small>
            <label>
              Bagian ini ingin diubah bagaimana?
              <textarea
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                required
                maxLength={2000}
                autoFocus
              />
            </label>
            <button className="review-primary" type="submit">
              Simpan catatan
              <Check size={15} />
            </button>
          </AppForm>
        ) : (
          <div className="review-note-list">
            {notes.map((n, i) => (
              <article key={n.id}>
                <div>
                  <strong>
                    {i + 1}. {n.page}
                  </strong>
                  <button
                    type="button"
                    aria-label={"Hapus catatan " + (i + 1)}
                    onClick={() => {
                      const next = notes.filter((r) => r.id !== n.id);
                      setNotes(next);
                      localStorage.setItem(storageKey, JSON.stringify(next));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <small>{n.label}</small>
                <p>{n.comment}</p>
              </article>
            ))}
            {notes.length > 0 ? (
              <>
                <button className="review-primary" onClick={copy}>
                  <Copy size={15} />
                  {copied ? "Tersalin" : "Salin catatan untuk chat"}
                </button>
                <small>
                  Tempel catatan ke chat ini agar perubahan bisa kukerjakan.
                </small>
                {copyText && (
                  <textarea
                    readOnly
                    rows={6}
                    value={copyText}
                    aria-label="Catatan untuk disalin"
                  />
                )}
              </>
            ) : (
              <p>
                Belum ada catatan. Pilih Tandai, lalu klik atau tarik area pada
                aplikasi.
              </p>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
