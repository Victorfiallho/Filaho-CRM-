import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  // Accessible name when there's no <label> pointing at the trigger.
  "aria-label"?: string;
}

let selectInstanceCounter = 0;

// Phones get a bottom sheet with large rows instead of a small floating list.
const SHEET_QUERY = "(max-width: 640px)";
const MENU_MAX_HEIGHT = 320;
const GAP = 6;

interface MenuPos { top?: number; bottom?: number; left: number; minWidth: number; maxHeight: number }

// Where the list goes: below the trigger when there's room (or more room
// than above), as wide as its longest label but at least the trigger's
// width, kept inside the viewport.
function menuPosition(rect: DOMRect): MenuPos {
  const below = window.innerHeight - rect.bottom - GAP - 8;
  const above = rect.top - GAP - 8;
  const openUp = below < 200 && above > below;
  const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, openUp ? above : below));
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 200) - 8));
  return openUp
    ? { bottom: window.innerHeight - rect.top + GAP, left, minWidth: rect.width, maxHeight }
    : { top: rect.bottom + GAP, left, minWidth: rect.width, maxHeight };
}

// Dropdown with the native <select> contract (value/onChange). The position
// is computed before the first paint; page scroll and resize reposition the
// list (it closes only once the trigger leaves the screen); scrolling inside
// the list just scrolls, and the highlighted row is kept visible by moving
// the list's own scrollTop, never the page.
//
// Keyboard: listbox with aria-activedescendant. Focus stays on the trigger;
// arrows, Home/End and type-ahead move the highlight; Enter/Space pick;
// Escape/Tab close.
export default function Select({ value, onChange, options, disabled, id, "aria-label": ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [sheet, setSheet] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const typeaheadRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const instanceId = useRef(`cs-${++selectInstanceCounter}`).current;

  const selected = options.find(o => o.value === value);
  const enabledIndexes = options.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0);

  function openMenu() {
    if (disabled || !options.length || !triggerRef.current) return;
    const currentIndex = options.findIndex(o => o.value === value);
    setHighlighted(currentIndex >= 0 && !options[currentIndex].disabled ? currentIndex : (enabledIndexes[0] ?? 0));
    const asSheet = window.matchMedia(SHEET_QUERY).matches;
    setSheet(asSheet);
    setPos(asSheet ? null : menuPosition(triggerRef.current.getBoundingClientRect()));
    setOpen(true);
  }

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close(true);
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
      case "ArrowDown": e.preventDefault(); moveHighlight(1); break;
      case "ArrowUp": e.preventDefault(); moveHighlight(-1); break;
      case "Home": e.preventDefault(); if (enabledIndexes.length) setHighlighted(enabledIndexes[0]); break;
      case "End": e.preventDefault(); if (enabledIndexes.length) setHighlighted(enabledIndexes[enabledIndexes.length - 1]); break;
      case "Enter":
      case " ": e.preventDefault(); commit(highlighted); break;
      case "Escape": e.preventDefault(); close(true); break;
      case "Tab": close(); break;
      default:
        // Typeahead, like a native <select>.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const now = Date.now();
          const buffer = now - typeaheadRef.current.at < 800 ? typeaheadRef.current.text + e.key : e.key;
          typeaheadRef.current = { text: buffer, at: now };
          const match = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(buffer.toLowerCase()));
          if (match >= 0) setHighlighted(match);
        }
    }
  }

  // Outside press closes; page scroll/resize repositions (closing only when
  // the trigger is scrolled out of view). Scrolls inside the list are ignored.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    let frame = 0;
    const reposition = (e?: Event) => {
      if (e && menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      if (sheet || !triggerRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) { close(); return; }
        setPos(menuPosition(rect));
      });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, sheet]);

  // Scroll the list itself; scrollIntoView() could scroll the page too.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const list = menuRef.current.querySelector<HTMLElement>(".cs-list") || menuRef.current;
    const row = list.querySelector<HTMLElement>(`#${instanceId}-opt-${highlighted}`);
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }, [open, highlighted, instanceId]);

  const optionsList = options.map((opt, i) => (
    <div
      key={opt.value}
      id={`${instanceId}-opt-${i}`}
      role="option"
      aria-selected={opt.value === value}
      aria-disabled={opt.disabled || undefined}
      className={`cs-option${opt.value === value ? " selected" : ""}${i === highlighted ? " highlighted" : ""}${opt.disabled ? " disabled" : ""}`}
      // Keep focus on the trigger (aria-activedescendant), so a click doesn't
      // blur it.
      onMouseDown={e => e.preventDefault()}
      onMouseEnter={() => setHighlighted(i)}
      onClick={() => commit(i)}
    >
      <span className="cs-option-label">{opt.label}</span>
      {opt.value === value && <Check className="cs-check" aria-hidden="true" />}
    </div>
  ));

  return (
    <div className="cs" ref={rootRef}>
      <button
        id={id}
        type="button"
        ref={triggerRef}
        className={`cs-trigger${open ? " open" : ""}`}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${instanceId}-menu` : undefined}
        aria-activedescendant={open ? `${instanceId}-opt-${highlighted}` : undefined}
      >
        <span className="cs-value">{selected?.label ?? ""}</span>
        <svg className="cs-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        sheet ? (
          <div className="cs-sheet-backdrop" onClick={() => close(true)}>
            <div
              ref={menuRef}
              id={`${instanceId}-menu`}
              className="cs-sheet"
              role="listbox"
              aria-label={ariaLabel || selected?.label}
              onClick={e => e.stopPropagation()}
            >
              <span className="cs-sheet-grip" aria-hidden="true" />
              <div className="cs-list">{optionsList}</div>
            </div>
          </div>
        ) : (
          <div
            ref={menuRef}
            id={`${instanceId}-menu`}
            className={`cs-menu${pos?.bottom !== undefined ? " up" : ""}`}
            role="listbox"
            aria-label={ariaLabel || selected?.label}
            style={pos ? { position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.minWidth, maxHeight: pos.maxHeight } : undefined}
          >
            {optionsList}
          </div>
        ),
        document.body
      )}
    </div>
  );
}
