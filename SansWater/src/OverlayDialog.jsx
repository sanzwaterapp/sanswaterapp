import React, { useEffect, useRef } from "react";

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
