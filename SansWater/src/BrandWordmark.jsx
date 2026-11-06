import React, { useId } from "react";
import { lettering, mountain, slogan } from "./brand-art.js";

export function BrandWordmark({ onDark = false } = {}) {
  const id = useId();
  return (
    <svg
      className="sanz-brand-wordmark"
      viewBox="0 0 889 269"
      role="img"
      aria-label="Sanz Water · Depo Air Minum"
      focusable="false"
      fillRule="evenodd"
    >
      <defs>
        <linearGradient id={id + "-ink"} x2="0" y2="1">
          <stop stopColor={onDark ? "#fff" : "var(--sanz-wordmark-top, #302e84)"} />
          <stop
            offset="1"
            stopColor={onDark ? "#bce8ff" : "var(--sanz-wordmark-bottom, #00a2e4)"}
          />
        </linearGradient>
      </defs>
      <path d={lettering} transform="translate(0 52)" fill={`url(#${id}-ink)`} />
      <g fill={onDark ? "#c8ef9a" : "var(--sanz-wordmark-green, #4aa935)"}>
        <path d={mountain} transform="translate(570 0)" />
        <path d={slogan} transform="translate(155 218)" />
      </g>
    </svg>
  );
}

export function isSanzBrand(name) {
  return !name || name.trim().toLowerCase() === "sanz water";
}

