function displayLimit(value, type) {
  if (type === "number") return Number(value).toLocaleString("id-ID");
  if (type === "date")
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value + "T00:00:00Z"));
  return value;
}

export function validationMessage(
  validity,
  {
    label = "Kolom ini",
    tag = "input",
    type = "text",
    min,
    max,
    minLength,
    maxLength,
    step,
  } = {},
) {
  if (validity.valid) return "";
  if (validity.badInput)
    return type === "number"
      ? `${label} harus berupa angka yang benar.`
      : `Format ${label.toLowerCase()} belum sesuai.`;
  if (validity.valueMissing) {
    if (tag === "select")
      return `Pilih ${label.toLowerCase()} terlebih dahulu.`;
    if (type === "checkbox" || type === "radio")
      return `Pilih ${label.toLowerCase()} terlebih dahulu.`;
    if (type === "file")
      return `Tambahkan ${label.toLowerCase()} terlebih dahulu.`;
    return `${label} wajib diisi.`;
  }
  if (validity.typeMismatch)
    return type === "email"
      ? `${label} harus berupa alamat email yang benar.`
      : `${label} harus berupa alamat tautan yang benar.`;
  if (validity.rangeUnderflow)
    return `${label} minimal ${displayLimit(min, type)}.`;
  if (validity.rangeOverflow)
    return `${label} maksimal ${displayLimit(max, type)}.`;
  if (validity.tooShort) return `${label} minimal ${minLength} karakter.`;
  if (validity.tooLong) return `${label} maksimal ${maxLength} karakter.`;
  if (validity.stepMismatch)
    return type === "number" && (!step || step === "1")
      ? `${label} harus berupa angka bulat.`
      : `${label} harus sesuai kelipatan ${step || "yang diizinkan"}.`;
  if (validity.patternMismatch)
    return `Format ${label.toLowerCase()} belum sesuai.`;
  return `Periksa kembali ${label.toLowerCase()}.`;
}

export function fieldLabel(field) {
  const explicit = field.getAttribute("aria-label");
  if (explicit) return explicit;
  if (field.type === "radio") {
    const legend = field.closest("fieldset")?.querySelector("legend");
    if (legend?.textContent.trim()) return legend.textContent.trim();
  }
  const label = field.labels?.[0];
  if (label) {
    const copy = label.cloneNode(true);
    copy
      .querySelectorAll("input, select, textarea, button, small, svg")
      .forEach((node) => node.remove());
    const text = copy.textContent.trim().replace(/\s+/g, " ");
    if (text) return text;
  }
  return field.getAttribute("placeholder") || "Kolom ini";
}

export function fieldValidationMessage(field) {
  return validationMessage(field.validity, {
    label: fieldLabel(field),
    tag: field.tagName.toLowerCase(),
    type: field.type,
    min: field.min,
    max: field.max,
    minLength: field.minLength,
    maxLength: field.maxLength,
    step: field.step,
  });
}
