// Custom dropdown selector for the status bar — opencode/codex style.
// A compact trigger button showing the current value, with a menu that
// opens upward (the bar sits at the bottom edge), grouped by option.group.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface SelectorOption {
  value: string;
  label: ReactNode;
  /** dim right-aligned meta, e.g. a Chinese gloss for a thinking level */
  hint?: ReactNode;
  /** options sharing a group are preceded by a group header */
  group?: string;
  /** shown dimmed and not selectable */
  disabled?: boolean;
}

interface SelectorProps {
  children: ReactNode;
  options: SelectorOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  /** align the menu's right edge with the trigger (for right-side bars) */
  alignRight?: boolean;
}

export function Selector({
  children,
  options,
  value,
  onChange,
  disabled,
  title,
  alignRight,
}: SelectorProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on any click outside the selector.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Highlight the current value when the menu opens.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  // Keep the highlighted option in view while navigating with arrows.
  useEffect(() => {
    if (!open || active < 0) return;
    rootRef.current
      ?.querySelectorAll<HTMLElement>('.selector-option')
      .item(active)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (!open && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
    } else if (open) {
      // Move the highlight by dir, skipping disabled options.
      const step = (from: number, dir: 1 | -1) => {
        let n = from;
        while (n >= 0 && n < options.length && options[n].disabled) n += dir;
        return Math.min(Math.max(n, 0), options.length - 1);
      };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => step(i + 1, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => step(i - 1, -1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const o = options[active];
        if (o && !o.disabled) select(o.value);
      }
    }
  };

  // Insert group headers where the group name changes between options.
  const rows: Array<{ kind: 'group'; label: string } | { kind: 'opt'; index: number }> = [];
  let lastGroup: string | undefined;
  options.forEach((o, i) => {
    if (o.group && o.group !== lastGroup) rows.push({ kind: 'group', label: o.group });
    lastGroup = o.group;
    rows.push({ kind: 'opt', index: i });
  });

  return (
    <div className="selector" ref={rootRef}>
      <button
        type="button"
        className="status-select"
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {children}
        <span className="sel-chev">▾</span>
      </button>
      {open && (
        <div
          className={`selector-menu${alignRight ? ' align-right' : ''}`}
          role="listbox"
        >
          {rows.length === 0 && <div className="selector-empty">暂无可用选项</div>}
          {rows.map((r, i) =>
            r.kind === 'group' ? (
              <div key={`g${i}`} className="selector-group">
                {r.label}
              </div>
            ) : (
              <button
                key={options[r.index].value}
                type="button"
                role="option"
                aria-selected={options[r.index].value === value}
                disabled={options[r.index].disabled}
                className={`selector-option${r.index === active ? ' active' : ''}${
                  options[r.index].value === value ? ' selected' : ''
                }`}
                onClick={() => !options[r.index].disabled && select(options[r.index].value)}
                onMouseEnter={() => !options[r.index].disabled && setActive(r.index)}
              >
                <span className="check">{options[r.index].value === value ? '✓' : ''}</span>
                <span className="label">{options[r.index].label}</span>
                {options[r.index].hint && <span className="hint">{options[r.index].hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
