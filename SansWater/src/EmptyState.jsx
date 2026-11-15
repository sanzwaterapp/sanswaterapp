import React from "react";
import { ClipboardList } from "lucide-react";

export default function Empty({
  children = "Belum ada catatan.",
  icon: Icon = ClipboardList,
  compact = false,
}) {
  return (
    <div
      className={compact ? "rv-empty-state is-compact" : "rv-empty-state"}
      role="status"
    >
      <span className="rv-empty-state-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <p>{children}</p>
    </div>
  );
}
