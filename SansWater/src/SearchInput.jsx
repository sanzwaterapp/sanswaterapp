import React, { useEffect, useRef, useState } from "react";

// Keep typing local; only commit a completed query to filters and API requests.
export default function SearchInput({ value = "", onChange, ...props }) {
  const [draft, setDraft] = useState(value),
    [composing, setComposing] = useState(false),
    commit = useRef(onChange);
  commit.current = onChange;
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (composing || draft === value) return;
    const timer = setTimeout(() => commit.current(draft), 400);
    return () => clearTimeout(timer);
  }, [draft, value, composing]);
  return (
    <input
      {...props}
      type="search"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={(e) => {
        setDraft(e.currentTarget.value);
        setComposing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !composing && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (draft !== value) commit.current(draft);
        }
      }}
    />
  );
}
