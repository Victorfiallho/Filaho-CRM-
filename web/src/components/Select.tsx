import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  id?: string;
}

// Custom-styled dropdown replacing the native <select>'s open-state popup —
// browsers render that popup with OS chrome that page CSS can't reach. Same
// value/onChange contract as a native select, so it drops in everywhere one
// was used. Business logic (what options exist, what's selected/disabled) is
// unchanged; this only replaces how the list looks when open.
//
// The menu is portaled to <body> with `position: fixed` coordinates computed
// from the trigger — several call sites (the Import Center preview table,
// modals) sit inside `overflow: auto` containers, and an absolutely
// positioned menu would get clipped by those instead of floating above them.
export default function Select({ value, onChange, options, disabled, id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; openUp: boolean; top?: number; bottom?: number }>({ left: 0, width: 0, openUp: false });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const openUp = rect.top > window.innerHeight / 2;
    const gap = 6;
    setPos(
      openUp
        ? { bottom: window.innerHeight - rect.top + gap, left: rect.left, width: rect.width, openUp }
        : { top: rect.bottom + gap, left: rect.left, width: rect.width, openUp }
    );
  }, [open]);

  return (
    <div className="cs" ref={rootRef}>
      <button
        id={id}
        type="button"
        ref={triggerRef}
        className={`cs-trigger${open ? " open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="cs-value">{selected?.label ?? ""}</span>
        <svg className="cs-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="cs-menu"
          role="listbox"
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`cs-option${opt.value === value ? " selected" : ""}`}
              disabled={opt.disabled}
              onClick={() => { if (opt.disabled) return; onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
