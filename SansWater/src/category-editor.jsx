import React, { useEffect, useRef, useState } from "react";
import { Grid2X2, Plus, SquarePen, Trash2, X } from "lucide-react";
import AppForm from "./AppForm.jsx";
import { api } from "./api.js";

export default function CategoryEditor({ data, act, onClose, Field, Submit }) {
  const [form, setForm] = useState(null);
  const editor = useRef(null);
  useEffect(() => {
    if (!form) return;
    const panel = editor.current?.querySelector(".rv-category-edit-form");
    panel?.scrollIntoView({ block: "center", behavior: "smooth" });
    panel?.querySelector("input")?.focus({ preventScroll: true });
  }, [!!form, form?.id]);
  const products = [...data.products, ...(data.archivedProducts || [])];
  return (
    <section className="rv-card rv-category-editor" ref={editor}>
      <header className="rv-blue-card-heading">
        <h3>
          <Grid2X2 size={17} /> Kategori produk
        </h3>
        <button
          type="button"
          className="rv-icon-button"
          aria-label="Tutup kategori"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="rv-category-editor-list">
        {data.categories.map((category) => {
          const count = products.filter(
            (p) => p.category_id === category.id,
          ).length;
          return (
            <div className="rv-category-editor-row" key={category.id}>
              <span>
                <strong>{category.name}</strong>
                <small>{count} produk</small>
              </span>
              <button
                type="button"
                className="rv-icon-button"
                aria-label={"Ubah kategori " + category.name}
                onClick={() => setForm({ ...category })}
              >
                <SquarePen size={16} />
              </button>
              <button
                type="button"
                className="rv-icon-button"
                aria-label={"Hapus kategori " + category.name}
                disabled={count > 0}
                title={
                  count
                    ? "Pindahkan produk aktif dan arsip ke kategori lain dahulu"
                    : "Hapus kategori kosong"
                }
                onClick={async () => {
                  await act(() =>
                    api("/categories/" + category.id, {
                      method: "DELETE",
                      body: { version: category.version },
                    }),
                  )
                    .then(() => {
                      if (form?.id === category.id) setForm(null);
                    })
                    .catch(() => {});
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="rv-category-editor-note">
        Kategori bisa dihapus setelah semua produknya dipindahkan, termasuk
        produk arsip.
      </p>
      <button
        type="button"
        className="rv-secondary rv-category-create"
        onClick={() =>
          setForm({ name: "", fund: data.cashFunds[0]?.key || "" })
        }
      >
        <Plus size={15} /> Tambah kategori
      </button>
      {form && (
        <AppForm
          className="rv-stack rv-category-edit-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await act(() =>
              api(form.id ? "/categories/" + form.id : "/categories", {
                method: form.id ? "PATCH" : "POST",
                body: {
                  name: form.name,
                  fund: form.fund,
                  version: form.version,
                },
              }),
            )
              .then(() => setForm(null))
              .catch(() => {});
          }}
        >
          <div className="rv-section-heading">
            <h3>{form.id ? "Ubah nama kategori" : "Kategori baru"}</h3>
            <button
              type="button"
              className="rv-icon-button"
              aria-label="Batal mengubah kategori"
              onClick={() => setForm(null)}
            >
              <X size={16} />
            </button>
          </div>
          <Field
            label="Nama kategori"
            required
            maxLength={60}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          {!form.id && (
            <Field label="Kas awal kategori">
              <select
                value={form.fund}
                required
                onChange={(event) =>
                  setForm({ ...form, fund: event.target.value })
                }
              >
                <option value="">Pilih kas</option>
                {data.cashFunds.map((fund) => (
                  <option key={fund.key} value={fund.key}>
                    {fund.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Submit>Simpan kategori</Submit>
        </AppForm>
      )}
    </section>
  );
}
