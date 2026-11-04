import React from "react";
import { durationBand, readableColor } from "./duration-settings.js";
export default function DurationChip({ minutes, settings }) {
  const band = durationBand(minutes, settings);
  return (
    <span
      className="rv-time"
      title={band.name}
      style={{ background: band.color, color: readableColor(band.color) }}
    >
      {minutes} menit
    </span>
  );
}
