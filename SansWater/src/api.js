import { durationLimits } from "./duration-settings.js";
import { encodePhoto } from "./photo-encoding.js";
const uncertain = new Map();
let lastMutationVersion = null;
export const mutationVersion = () => lastMutationVersion;
export async function api(path, { method = "GET", body, signal } = {}) {
  const fingerprint = method + path + JSON.stringify(body ?? {});
  const mutation = method !== "GET";
  const serialized = mutation ? JSON.stringify(body ?? {}) : undefined;
  if (serialized && new TextEncoder().encode(serialized).length > 4_000_000)
    throw new Error(
      "Data terlalu besar. Kurangi ukuran foto lalu coba kembali.",
    );
  if (mutation && !uncertain.has(fingerprint))
    uncertain.set(fingerprint, crypto.randomUUID());
  let response;
  try {
    response = await fetch("/api" + path, {
      method,
      signal,
      credentials: "same-origin",
      headers: mutation
        ? {
            "Content-Type": "application/json",
            "Idempotency-Key": uncertain.get(fingerprint),
          }
        : undefined,
      body: serialized,
    });
  } catch {
    throw new Error(
      "Koneksi terputus. Hasil simpan belum dapat dipastikan. Pertahankan isian lalu coba Simpan lagi untuk memeriksa tanpa menggandakan data.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      response.status === 413
        ? "Data terlalu besar. Kurangi ukuran foto dan coba kembali."
        : "Respons server belum lengkap. Pertahankan isian dan coba tombol yang sama untuk memeriksa hasil simpan.",
    );
    error.status = response.ok ? 502 : response.status;
    if (response.status === 413) uncertain.delete(fingerprint);
    throw error;
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/login" &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("depot:unauthorized"));
    if (response.status < 500) uncertain.delete(fingerprint);
    const error = new Error(result.error || "Permintaan belum berhasil.");
    error.status = response.status;
    throw error;
  }
  uncertain.delete(fingerprint);
  if (mutation) lastMutationVersion = response.headers.get("X-Data-Version");
  return result;
}
export const money = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  })
    .format(n || 0)
    .replace(/\s/g, "");
export const dateLabel = (d) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
  }).format(new Date(d.length === 10 ? d + "T00:00:00+07:00" : d));
export const timeLabel = (d) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(d));
export const can = (user, key) =>
  !!user?.owner || !!user?.permissions.includes(key);
export const statuses = {
  new: "Pesanan",
  pickup: "Menjemput",
  fill: "Mengisi",
  delivery: "Antar",
  partial: "Terkirim sebagian",
  done: "Selesai",
  failed: "Gagal",
  cancel: "Batal",
};
export const filters = {
  orders: ["new", "pickup", "partial"],
  fill: ["fill"],
  delivery: ["delivery"],
  done: ["done"],
  failed: ["failed", "cancel"],
};
export const filterLabels = {
  orders: "Pesanan",
  fill: "Mengisi",
  delivery: "Antar",
  done: "Selesai",
  failed: "Gagal",
};
export function duration(order, now = Date.now()) {
  if (order.kind === "counter") return 0;
  return Math.max(
    0,
    Math.floor(
      ((order.first_departure_at
        ? new Date(order.first_departure_at).getTime()
        : now) -
        new Date(order.received_at).getTime()) /
        60000,
    ),
  );
}
export function sortDisplayOrders(orders, now = Date.now()) {
  return [...orders].sort(
    (a, b) =>
      duration(b, now) - duration(a, now) ||
      Date.parse(a.received_at) - Date.parse(b.received_at) ||
      String(a.id).localeCompare(String(b.id)),
  );
}
export const durationColor = (n, settings) => {
  const limits = durationLimits(settings);
  return n >= limits.late
    ? "red"
    : n >= limits.warning
      ? "yellow"
      : n >= limits.fast
        ? "green"
        : "blue";
};
export async function imageFile(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Pilih berkas foto.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Foto tidak dapat dibaca. Pilih foto lain.");
  }
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return encodePhoto(canvas);
}
