import React from "react";

// A water drop with an S-shaped current, shared by the app and sign-in screen.
export default function BrandMark() {
  return (
    <svg
      className="sanz-brand-mark"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M18 2C15 7.5 5.5 15.5 5.5 23a12.5 12.5 0 0 0 25 0C30.5 15.5 21 7.5 18 2Z"
        fill="currentColor"
      />
      <path
        d="M23 17c-2.3-2.7-9.4-2-9.4 1.6 0 3.4 9.6 1.3 9.6 5.1 0 3.3-7.2 4.6-10.2 1.7"
        stroke="var(--sanz-mark-wave, #3d3bff)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
