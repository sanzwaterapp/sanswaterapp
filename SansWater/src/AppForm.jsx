import React, { useEffect, useId, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { fieldValidationMessage } from "./form-validation.js";

export default function AppForm({
  children,
  onSubmit,
  onInputCapture,
  onChangeCapture,
  onReset,
  ...props
}) {
  const [error, setError] = useState(null);
  const messageId = useId();
  const marked = useRef(null);
  function clear() {
    const previous = marked.current;
    if (previous) {
      for (const [attribute, value] of Object.entries(previous.attributes)) {
        if (value === null) previous.field.removeAttribute(attribute);
        else previous.field.setAttribute(attribute, value);
      }
      marked.current = null;
    }
    setError(null);
  }
  useEffect(() => {
    const otherSubmit = (event) => {
      if (marked.current && event.target !== marked.current.field.form) clear();
    };
    document.addEventListener("submit", otherSubmit, true);
    return () => {
      document.removeEventListener("submit", otherSubmit, true);
      const previous = marked.current;
      if (previous)
        for (const [attribute, value] of Object.entries(previous.attributes)) {
          if (value === null) previous.field.removeAttribute(attribute);
          else previous.field.setAttribute(attribute, value);
        }
    };
  }, []);
  function clearIfFixed(event) {
    if (marked.current?.field === event.target && event.target.validity.valid)
      clear();
  }
  useEffect(() => {
    if (!error?.visible) return;
    const timer = setTimeout(() => {
      setError((current) => (current ? { ...current, visible: false } : null));
    }, 4000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    const field = marked.current?.field;
    if (!field) return;
    if (!field.isConnected || !field.willValidate || field.validity.valid)
      clear();
    else {
      const message = fieldValidationMessage(field);
      if (message !== error?.message)
        setError({ message, visible: error?.visible ?? false });
    }
  });
  return (
    <form
      {...props}
      noValidate
      onSubmit={(event) => {
        const field = Array.from(event.currentTarget.elements).find(
          (element) => element.willValidate && !element.validity.valid,
        );
        clear();
        if (field) {
          event.preventDefault();
          event.stopPropagation();
          const attributes = {
            "aria-invalid": field.getAttribute("aria-invalid"),
            "aria-describedby": field.getAttribute("aria-describedby"),
          };
          marked.current = { field, attributes };
          field.setAttribute("aria-invalid", "true");
          field.setAttribute(
            "aria-describedby",
            [attributes["aria-describedby"], messageId]
              .filter(Boolean)
              .join(" "),
          );
          setError({ message: fieldValidationMessage(field), visible: true });
          field.focus();
          return;
        }
        onSubmit?.(event);
      }}
      onInputCapture={(event) => {
        clearIfFixed(event);
        onInputCapture?.(event);
      }}
      onChangeCapture={(event) => {
        clearIfFixed(event);
        onChangeCapture?.(event);
      }}
      onReset={(event) => {
        clear();
        onReset?.(event);
      }}
    >
      {children}
      {error && (
        <div
          className={
            error.visible
              ? "rv-validation-message"
              : "rv-validation-description"
          }
          id={messageId}
          role={error.visible ? "alert" : undefined}
        >
          {error.visible && <AlertCircle size={18} aria-hidden="true" />}
          <span>{error.message}</span>
        </div>
      )}
    </form>
  );
}
