import React, { useEffect, useRef, useState } from "react";
import { Wallet, Plus, X, SquarePen, Check } from "lucide-react";
import AppForm from "./AppForm.jsx";
import { api } from "./api.js";

export default function CashGroupEditor({ data, act, onClose, Field, Submit }) {
  const [fundForm, setFundForm] = useState(null),
    [adding, setAdding] = useState(null),
    [selected, setSelected] = useState("");
  const funds = data.cashFunds || [];
  const editor = useRef(null);
  useEffect(() => {
    const form = editor.current?.querySelector(".rv-cash-group-editing");
    if (!form) return;
    form.scrollIntoView({ block: "center", behavior: "smooth" });
    form.querySelector("input")?.focus({ preventScroll: true });
  }, [fundForm?.key]);
  async function assign(c, fund) {
    await act(() =>
      api("/categories/" + c.id, {
        method: "PATCH",
        body: { version: c.version, fund },
      }),
    )
      .then(() => {
        setAdding(null);
        setSelected("");
      })
      .catch(() => {});
  }
  return (
    <section className="rv-card rv-cash-group-editor" ref={editor}>
      <header className="rv-blue-card-heading">
        <h3>
          <Wallet size={17} /> Kategori kas
        </h3>
        <button
          type="button"
          className="rv-icon-button"
          aria-label="Tutup pengaturan kategori"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="rv-cash-groups">
        {funds.map((f) => (
          <article
            className={
              "rv-cash-group" +
              (fundForm?.key === f.key ? " rv-cash-group-editing" : "")
            }
            key={f.key}
          >
            <div className="rv-cash-group-title">
              <h4>{f.name}</h4>
              <button
                type="button"
                className="rv-icon-button"
                aria-label={"Edit kategori kas " + f.name}
                aria-expanded={fundForm?.key === f.key}
                onClick={() => {
                  setAdding(null);
                  setSelected("");
                  setFundForm(fundForm?.key === f.key ? null : { ...f });
                }}
              >
                <SquarePen size={16} />
              </button>
            </div>
            {fundForm?.key === f.key && (
              <AppForm
                className="rv-stack rv-group-edit-form rv-group-name-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await act(() =>
                    api("/cash-funds/" + fundForm.key, {
                      method: "PATCH",
                      body: {
                        name: fundForm.name,
                        version: fundForm.version,
                      },
                    }),
                  )
                    .then(() => {
                      setFundForm(null);
                      setAdding(null);
                      setSelected("");
                    })
                    .catch(() => {});
                }}
              >
                <Field
                  label="Nama kas"
                  required
                  maxLength={60}
                  value={fundForm.name}
                  onChange={(e) =>
                    setFundForm({ ...fundForm, name: e.target.value })
                  }
                />
                <Submit aria-label="Simpan nama kas">Simpan</Submit>
              </AppForm>
            )}
            <div className="rv-category-members">
              {data.categories
                .filter((c) => c.fund === f.key)
                .map((c) => (
                  <span className="rv-category-member" key={c.id}>
                    <span>{c.name}</span>
                    {fundForm?.key === f.key && (
                      <button
                        type="button"
                        aria-label={
                          "Keluarkan kategori " + c.name + " dari " + f.name
                        }
                        onClick={() => assign(c, null)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </span>
                ))}
              {!data.categories.some((c) => c.fund === f.key) && (
                <span className="rv-group-empty">Belum ada kategori</span>
              )}
              {fundForm?.key === f.key && adding !== f.key && (
                <button
                  type="button"
                  className="rv-text-button rv-add-group-category"
                  onClick={() => {
                    setAdding(f.key);
                    setSelected("");
                  }}
                >
                  <Plus size={14} /> Kategori produk
                </button>
              )}
            </div>
            {fundForm?.key === f.key && adding === f.key ? (
              <AppForm
                className="rv-group-assign"
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = data.categories.find((c) => c.id === selected);
                  if (c) assign(c, f.key);
                }}
              >
                <select
                  aria-label={"Kategori untuk " + f.name}
                  required
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Pilih kategori</option>
                  {data.categories
                    .filter((c) => c.fund !== f.key)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <button
                  type="submit"
                  className="rv-icon-button"
                  aria-label="Tambahkan kategori ke kas"
                >
                  <Check size={18} />
                </button>
                <button
                  type="button"
                  className="rv-icon-button"
                  aria-label="Batal memilih kategori"
                  onClick={() => setAdding(null)}
                >
                  <X size={16} />
                </button>
              </AppForm>
            ) : null}
          </article>
        ))}
        {data.categories.some((c) => !c.fund) && (
          <div className="rv-ungrouped-categories">
            <strong>Belum dikelompokkan</strong>
            <div className="rv-category-members">
              {data.categories
                .filter((c) => !c.fund)
                .map((c) => (
                  <span key={c.id} className="rv-category-member">
                    <span>{c.name}</span>
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
