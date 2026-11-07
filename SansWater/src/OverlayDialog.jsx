import React, { useEffect, useRef } from "react";

export function LoadingState({ compact = false }) {
  return (
    <div
      className={"rv-loading-state" + (compact ? " rv-loading-compact" : "")}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="rv-loading-label">Memuat…</span>
    </div>
  );
}

export default function OverlayDialog({
  onClose,
  children,
  className = "",
  ...props
}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current,
      focus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (focus?.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      {...props}
      className={"rv-overlay-dialog " + className}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
