export const MAX_PHOTO_BYTES = 320 * 1024;
export function photoBytes(data) {
  const encoded = data.slice(data.indexOf(",") + 1);
  return (
    Math.floor((encoded.length * 3) / 4) -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0)
  );
}

// Three meter photos together stay comfortably below the function's payload
// limit. Keep dimensions first; reduce dimensions only after quality steps.
export function encodePhoto(
  canvas,
  makeCanvas = () => document.createElement("canvas"),
) {
  let current = canvas;
  for (let step = 0; step < 5; step++) {
    for (const quality of [0.82, 0.74, 0.66, 0.58]) {
      const data = current.toDataURL("image/jpeg", quality);
      if (
        data.startsWith("data:image/jpeg;base64,") &&
        photoBytes(data) <= MAX_PHOTO_BYTES
      )
        return data;
    }
    const next = makeCanvas();
    next.width = Math.max(1, Math.round(current.width * 0.85));
    next.height = Math.max(1, Math.round(current.height * 0.85));
    next.getContext("2d").drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  throw new Error(
    "Foto masih terlalu besar. Ambil ulang dengan pencahayaan lebih baik.",
  );
}
