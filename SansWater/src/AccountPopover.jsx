import React, { useLayoutEffect, useRef } from "react";

export default function AccountPopover({
  anchorRef,
  onClose,
  children,
  view,
  ...props
}) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const panel = ref.current,
      anchor = anchorRef.current;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const top = Math.max(8, rect.bottom + 8);
      panel.style.top = top + "px";
      panel.style.left =
        Math.max(
          8,
          Math.min(
            rect.right - panel.offsetWidth,
            window.innerWidth - panel.offsetWidth - 8,
          ),
        ) + "px";
      panel.style.maxHeight =
        Math.max(100, window.innerHeight - top - 12) + "px";
    }
    function outside(event) {
      if (!panel.contains(event.target) && !anchor.contains(event.target))
        close.current();
    }
    function escape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
    }
    panel.showPopover();
    place();
    panel.querySelector("button")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      const restore =
        panel.contains(document.activeElement) ||
        document.activeElement === document.body;
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      panel.hidePopover();
      if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchorRef]);
  return (
    <div
      ref={ref}
      popover="manual"
      role="dialog"
      {...props}
      className="rv-account-menu"
      data-view={view}
    >
      {children}
    </div>
  );
}
