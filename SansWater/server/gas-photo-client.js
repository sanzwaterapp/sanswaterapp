import { createHash, createHmac, randomBytes } from "node:crypto";

export const PHOTO_LIMIT = 5 * 1024 * 1024;
export const photoHash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
function problem(message, code = "GAS_UNAVAILABLE") {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  return error;
}

export class GasPhotoClient {
  constructor({
    url,
    secret,
    fetchImpl = fetch,
    clock = Date.now,
    timeout = 25000,
  }) {
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== "script.google.com" ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname) ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port
    )
      throw new Error(
        "GAS_PHOTO_URL harus URL deployment https://script.google.com/macros/s/.../exec.",
      );
    if (!/^[a-f0-9]{64}$/.test(secret || ""))
      throw new Error(
        "GAS_PHOTO_SECRET harus 64 karakter hex dan sama dengan Script Properties GAS.",
      );
    Object.assign(this, {
      url: endpoint.href,
      secret,
      fetchImpl,
      clock,
      timeout,
    });
  }
  async request(action, data = {}) {
    const envelope = {
      v: 1,
      action,
      ts: this.clock(),
      nonce: randomBytes(16).toString("hex"),
      payload: Buffer.from(JSON.stringify(data)).toString("base64"),
    };
    envelope.signature = createHmac("sha256", this.secret)
      .update(
        [1, action, envelope.ts, envelope.nonce, envelope.payload].join("\n"),
      )
      .digest("hex");
    const signal = AbortSignal.timeout(this.timeout);
    try {
      let response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(envelope),
        redirect: "manual",
        signal,
      });
      // Apps Script ContentService redirects to a one-time Google URL.
      for (
        let hop = 0;
        hop < 3 && [301, 302, 303].includes(response.status);
        hop++
      ) {
        const location = new URL(response.headers.get("location"), this.url);
        if (
          location.protocol !== "https:" ||
          location.hostname !== "script.googleusercontent.com" ||
          location.username ||
          location.password ||
          location.port
        )
          throw problem(
            "Deployment GAS belum dapat diakses server. Periksa pengaturan web app.",
          );
        response = await this.fetchImpl(location.href, {
          method: "GET",
          redirect: "manual",
          signal,
        });
      }
      if (!response.ok)
        throw problem("Layanan foto GAS belum dapat dihubungi.");
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw problem("Respons foto GAS terlalu besar.", "GAS_RESPONSE");
        }
        chunks.push(Buffer.from(value));
      }
      let result;
      try {
        result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw problem(
          "Respons GAS bukan JSON. Periksa deployment dan hak akses web app.",
          "GAS_RESPONSE",
        );
      }
      if (!result.ok) {
        const code = /^[A-Z_]{1,30}$/.test(result.code || "")
          ? result.code
          : "UNAVAILABLE";
        throw problem(
          "GAS menolak permintaan foto (" + code + ").",
          "GAS_" + code,
        );
      }
      if (!result.data || typeof result.data !== "object")
        throw problem("Respons foto GAS belum benar.", "GAS_RESPONSE");
      return result.data;
    } catch (error) {
      if (error.status === 503) throw error;
      throw problem(
        "Koneksi penyimpanan foto GAS terputus. Foto lokal tetap dipertahankan.",
      );
    }
  }
  async health() {
    const result = await this.request("health");
    if (result.version !== 1 || result.ready !== true)
      throw problem("Versi layanan foto GAS belum sesuai.", "GAS_RESPONSE");
    return result;
  }
  validate(result, expected) {
    if (
      result.photoId !== expected.photoId ||
      result.sha256 !== expected.sha256 ||
      result.size !== expected.size ||
      result.mime !== expected.mime ||
      !/^[A-Za-z0-9_-]{10,200}$/.test(result.fileId || "")
    )
      throw problem(
        "Verifikasi salinan foto Google Drive gagal. Foto lokal dipertahankan.",
        "GAS_VERIFY",
      );
  }
  async put(photo) {
    if (photo.bytes.length > PHOTO_LIMIT)
      throw problem("Ukuran foto melebihi batas.", "GAS_VERIFY");
    const expected = {
      photoId: photo.id,
      mime: photo.mime,
      size: photo.bytes.length,
      sha256: photoHash(photo.bytes),
    };
    const result = await this.request("put", {
      ...expected,
      base64: photo.bytes.toString("base64"),
    });
    this.validate(result, expected);
    return { ...expected, fileId: result.fileId };
  }
  async get(expected) {
    const result = await this.request("get", expected);
    this.validate(result, expected);
    if (
      result.fileId !== expected.fileId ||
      typeof result.base64 !== "string" ||
      result.base64.length > Math.ceil(PHOTO_LIMIT / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64)
    )
      throw problem("Isi foto Google Drive belum sesuai.", "GAS_VERIFY");
    const bytes = Buffer.from(result.base64, "base64");
    if (bytes.length !== expected.size || photoHash(bytes) !== expected.sha256)
      throw problem("Checksum foto Google Drive tidak sesuai.", "GAS_VERIFY");
    return { binary: bytes, mime: expected.mime };
  }
}
