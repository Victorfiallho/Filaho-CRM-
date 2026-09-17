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

let selectInstanceCounter = 0;

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
//
// Keyboard support (added after a UX pass found the original had none beyond
// Escape, despite declaring role="listbox"/"option" — a real <select> and
// any screen reader user would expect full arrow-key/typeahead operation
// from that ARIA contract). Follows the standard "listbox with
// aria-activedescendant" pattern: focus stays on the trigger button the
// whole time, a `highlighted` index drives both the visual highlight and
// aria-activedescendant, and Enter/Space commits it — never moving real DOM
// focus into the popup, which is what lets Escape/Tab/blur all behave the
// way a native select's users already expect.
export default function Select({ value, onChange, options, disabled, id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; openUp: boolean; top?: number; bottom?: number }>({ left: 0, width: 0, openUp: false });
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const instanceId = useRef(`cs-${++selectInstanceCounter}`).current;

  const selected = options.find(o => o.value === value);
  const enabledIndexes = options.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0);

  function openMenu() {
    if (disabled || !options.length) return;
    const currentIndex = options.findIndex(o => o.value === value);
    setHighlighted(currentIndex >= 0 && !options[currentIndex].disabled ? currentIndex : (enabledIndexes[0] ?? 0));
    setOpen(true);
  }

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(direction: 1 | -1) {
    setHighlighted(prev => {
      if (!enabledIndexes.length) return prev;
      const currentPos = enabledIndexes.indexOf(prev);
      const nextPos = currentPos === -1
        ? (direction === 1 ? 0 : enabledIndexes.length - 1)
        : (currentPos + direction + enabledIndexes.length) % enabledIndexes.length;
      return enabledIndexes[nextPos];
    });
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveHighlight(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveHighlight(-1);
        break;
      case "Home":
        e.preventDefault();
        if (enabledIndexes.length) setHighlighted(enabledIndexes[0]);
        break;
      case "End":
        e.preventDefault();
        if (enabledIndexes.length) setHighlighted(enabledIndexes[enabledIndexes.length - 1]);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(highlighted);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        // Typeahead: typing letters jumps to the next option whose label
        // starts with what's been typed so far (reset after a short pause),
        // matching a native <select>'s own typeahead behavior.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const now = Date.now();
          const buffer = now - typeaheadRef.current.at < 800 ? typeaheadRef.current.text + e.key : e.key;
          typeaheadRef.current = { text: buffer, at: now };
          const lower = buffer.toLowerCase();
          const match = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(lower));
          if (match >= 0) setHighlighted(match);
        }
    }
  }

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
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

  // Keeps the highlighted option scrolled into view as arrow keys move past
  // the edge of the (max-height, overflow:auto) menu.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`#${instanceId}-opt-${highlighted}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted, instanceId]);

  return (
    <div className="cs" ref={rootRef}>
      <button
        id={id}
        type="button"
        ref={triggerRef}
        className={`cs-trigger${open ? " open" : ""}`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${instanceId}-menu` : undefined}
        aria-activedescendant={open ? `${instanceId}-opt-${highlighted}` : undefined}
      >
        <span className="cs-value">{selected?.label ?? ""}</span>
        <svg className="cs-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={`${instanceId}-menu`}
          className="cs-menu"
          role="listbox"
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width }}
        >
          {options.map((opt, i) => (
            <button
              key={opt.value}
              id={`${instanceId}-opt-${i}`}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              tabIndex={-1}
              className={`cs-option${opt.value === value ? " selected" : ""}${i === highlighted ? " highlighted" : ""}`}
              disabled={opt.disabled}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => commit(i)}
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
