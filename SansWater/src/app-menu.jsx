import React, { useEffect, useRef } from "react";
import { Menu, UserRound, ChevronRight, LogOut } from "lucide-react";
import { menuItemsFor } from "./app-menu-items.js";
import BrandMark from "./BrandMark.jsx";

function SideMenu({ data, page, onClose, onNavigate, onLogout }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    (
      dialog.querySelector('[aria-current="page"]') ||
      dialog.querySelector("#rv-side-menu-title button")
    )?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="rv-side-menu"
      aria-labelledby="rv-side-menu-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="rv-side-menu-panel">
        <div className="rv-side-menu-heading">
          <h2 id="rv-side-menu-title">
            <button type="button" onClick={onClose} aria-label="Tutup menu">
              <Menu size={20} aria-hidden="true" />
              Menu
            </button>
          </h2>
        </div>
        <div className="rv-side-account">
          <span className="rv-side-avatar">
            <UserRound size={22} />
          </span>
          <span className="rv-side-account-copy">
            <strong>{data.user.name}</strong>
            <small>{data.settings.name || "Sanz Water"}</small>
          </span>
          <button
            type="button"
            className="rv-side-logout"
            aria-label="Keluar akun"
            title="Keluar akun"
            onClick={onLogout}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className="rv-side-menu-links" aria-label="Menu aplikasi">
          {menuItemsFor(data.user).map(([key, title, note, Icon]) => (
            <button
              type="button"
              key={key}
              aria-current={page === key ? "page" : undefined}
              onClick={() => {
                onClose();
                onNavigate(key);
              }}
            >
              <span
                className={
                  "rv-menu-icon rv-side-menu-icon " +
                  (["products", "display"].includes(key)
                    ? "rv-peach"
                    : key === "staff"
                      ? "rv-mint"
                      : "")
                }
              >
                <Icon size={19} />
              </span>
              <span>
                <strong>{title}</strong>
                <small>{note}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>
      </div>
    </dialog>
  );
}

export function AppBar({
  data,
  page,
  open,
  onOpen,
  onClose,
  onNavigate,
  onLogout,
  onAccount,
  accountOpen,
  accountRef,
}) {
  return (
    <>
      <header className="rv-app-bar" aria-label="Header aplikasi">
        <button
          type="button"
          className="rv-app-menu-toggle"
          aria-label="Buka menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={onOpen}
        >
          <Menu size={21} />
        </button>
        <span className="rv-app-brand">
          <BrandMark />
          <span className="rv-app-wordmark">
            <strong>{data.settings.name || "Sanz Water"}</strong>
            <small>Depot air minum</small>
          </span>
        </span>
        <button
          type="button"
          className="rv-app-user"
          ref={accountRef}
          title={data.user.name}
          onClick={onAccount}
          aria-label={"Menu akun " + data.user.name}
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
        >
          <UserRound size={17} />
          <span>{data.user.name}</span>
        </button>
      </header>
      {open && (
        <SideMenu
          data={data}
          page={page}
          onClose={onClose}
          onNavigate={onNavigate}
          onLogout={onLogout}
        />
      )}
    </>
  );
}
