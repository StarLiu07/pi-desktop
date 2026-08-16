// ZCode-style message rail: a slim strip on the chat's left edge with one bar
// per user message. Click a bar to jump to that message; the bar for the
// message currently crossing the "cursor line" (100px below the viewport top)
// is highlighted white. A click pins the highlight until the user scrolls —
// same model as ZCode's session message nav. Hovering a bar floats a preview
// of that user message next to the rail.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useStore } from '../store/useStore';
import type { ContentPart } from '../rpc/types';

// Deferred chunk (same lazy stack as Message.tsx); loads when the first
// preview opens, falls back to plain text while loading.
const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })));

/** Viewport line (px from the chat box top) that decides the highlighted bar. */
const CURSOR_LINE = 100;
/** Hide the rail when the centered message column reaches its right edge. */
const RAIL_OVERLAP = 48;
/** Grace (ms) to move the pointer from a 2px bar across the gap onto its
 * preview popover before the popover closes. */
const HOVER_GRACE = 250;

interface Marker {
  idx: number;
  /** bar position as a fraction of the rail height (0..1) */
  frac: number;
  /** turn span (user message through its replies) inside the chat box */
  top: number;
  bottom: number;
}

/** Recursively extract plain text from a content part (tool results nest arrays). */
function partText(c: ContentPart): string {
  if (typeof c.text === 'string') return c.text;
  if (Array.isArray(c.content)) {
    return c.content
      .map((x) => (typeof x === 'string' ? x : partText(x as ContentPart)))
      .join('\n');
  }
  return '';
}

export function MessageNav({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const tab = useStore((s) => s.tabs[s.activeTabIndex]);
  const activeTabIndex = useStore((s) => s.activeTabIndex);
  const userMsgs = (tab?.messages ?? []).filter((m) => m.role === 'user');
  const userCount = userMsgs.length;

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [active, setActive] = useState(-1);
  const [hidden, setHidden] = useState(false);
  /** Index of the bar currently hovered, -1 when none — drives the preview popover. */
  const [hover, setHover] = useState(-1);
  /** Set while the highlight is pinned to a clicked bar (until the user scrolls). */
  const pinnedRef = useRef(false);
  const lastKeyRef = useRef('');
  const activeRef = useRef(-1);
  const hideTimerRef = useRef(0);
  /** True while the pointer is down inside the popover (text selection) — the
   * popover must not hide until the drag ends. */
  const suppressHideRef = useRef(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Hover-intent show/hide: leaving a bar does not hide the popover
  // immediately — a short grace lets the pointer cross the gap onto the
  // popover itself (a 2px bar is a hard target otherwise).
  const showPreview = (idx: number) => {
    window.clearTimeout(hideTimerRef.current);
    suppressHideRef.current = false;
    setHover(idx);
  };
  const scheduleHide = () => {
    if (suppressHideRef.current) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setHover(-1), HOVER_GRACE);
  };

  // Keep the popover inside the chat: center it on the hovered bar, clamped
  // to the rail's bounds so a tall preview cannot cross the window edge.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const nav = railRef.current;
    if (!pop || !nav || hover < 0) return;
    const y = (markers[hover]?.frac ?? 0.5) * nav.clientHeight;
    const h = pop.offsetHeight;
    const maxTop = Math.max(4, nav.clientHeight - h - 4);
    pop.style.top = `${Math.min(Math.max(y - h / 2, 4), maxTop)}px`;
    pop.style.transform = 'translateY(0)';
  }, [hover, markers]);

  // Unmount cleanup for the hide timer.
  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);

  // Measure turn spans inside the chat box, then map them onto the rail.
  // Runs on scroll (rAF-throttled) and whenever content or the viewport size
  // changes — marker fractions follow the content as it grows.
  const measure = () => {
    const chat = scrollRef.current;
    if (!chat) return;
    const rows = chat.querySelectorAll('.message-row');
    if (rows.length === 0) {
      lastKeyRef.current = '';
      setMarkers([]);
      setActive(-1);
      return;
    }
    const chatRect = chat.getBoundingClientRect();
    // A user row opens a turn, which spans until the next user row (or the
    // end of the content) — the same unit ZCode's cursor-line test uses.
    const spans: Marker[] = [];
    rows.forEach((el) => {
      const r = el.getBoundingClientRect();
      const top = r.top - chatRect.top;
      if (el.classList.contains('user')) {
        const idx = spans.length;
        spans.push({ idx, frac: 0, top, bottom: top });
      } else if (spans.length > 0) {
        const last = spans[spans.length - 1];
        last.bottom = Math.max(last.bottom, r.bottom - chatRect.top);
      }
    });
    const inner = chat.querySelector('.chat-inner');
    if (inner && spans.length > 0) {
      const last = spans[spans.length - 1];
      last.bottom = Math.max(last.bottom, inner.getBoundingClientRect().bottom - chatRect.top);
    }
    const count = spans.length;
    setHidden(inner ? inner.getBoundingClientRect().left - chatRect.left < RAIL_OVERLAP : false);

    // Cursor-line hit test (ZCode's cursor2): the turn spanning the line wins;
    // fall back to the nearest visible turn, then the last turn above the line.
    // While pinned (after a bar click) the highlight stays where the click
    // placed it until a user gesture releases the pin.
    let nextActive = pinnedRef.current ? activeRef.current : -1;
    if (!pinnedRef.current) {
      const line = CURSOR_LINE;
      const shown = spans.filter((m) => m.bottom > 0 && m.top < chat.clientHeight);
      const hit = shown.find((m) => m.top <= line && m.bottom >= line);
      if (hit) {
        nextActive = hit.idx;
      } else {
        let best: Marker | undefined;
        let bestDist = Infinity;
        for (const m of shown) {
          const d = Math.abs(m.top - line);
          if (d < bestDist) {
            bestDist = d;
            best = m;
          }
        }
        if (!best) {
          for (let i = spans.length - 1; i >= 0; i--) {
            if (spans[i].top <= line) {
              best = spans[i];
              break;
            }
          }
        }
        nextActive = best ? best.idx : spans[0]?.idx ?? -1;
      }
    }

    // Bars form a fixed cluster centered on the rail — selecting a message
    // only moves the white highlight between bars; the bars themselves never
    // jump around (a cluster that followed the active message's content
    // position snapped to the rail edges when the first/last message was
    // selected). The white bar marks the current message; the others are
    // stacked against it at a fixed ~14px step.
    const step = chat.clientHeight > 0 ? 14 / chat.clientHeight : 0.02;
    for (let i = 0; i < count; i++) {
      const f = 0.5 + (i - (count - 1) / 2) * step;
      spans[i].frac = Math.min(1, Math.max(0, f));
    }

    const key = `${hidden}|${nextActive}|${spans.map((m) => `${m.idx}:${m.frac.toFixed(3)}`).join(',')}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    setMarkers(spans);
    activeRef.current = nextActive;
    setActive(nextActive);
  };

  // Re-measure on scroll (rAF), on content/size changes, and per message count.
  useEffect(() => {
    const chat = scrollRef.current;
    if (!chat) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    chat.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(chat);
    const inner = chat.querySelector('.chat-inner');
    if (inner) ro.observe(inner);
    measure();
    return () => {
      chat.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [userCount, activeTabIndex]);

  // A new user message unpins the highlight (follow the growing conversation).
  useEffect(() => {
    pinnedRef.current = false;
  }, [userCount]);

  // Any user gesture on the chat (wheel / touch / scrollbar drag) releases the pin.
  useEffect(() => {
    const chat = scrollRef.current;
    if (!chat) return;
    const unpin = () => {
      pinnedRef.current = false;
    };
    chat.addEventListener('wheel', unpin, { passive: true, capture: true });
    chat.addEventListener('touchstart', unpin, { passive: true, capture: true });
    chat.addEventListener('pointerdown', unpin, { capture: true });
    return () => {
      chat.removeEventListener('wheel', unpin, { capture: true });
      chat.removeEventListener('touchstart', unpin, { capture: true });
      chat.removeEventListener('pointerdown', unpin, { capture: true });
    };
  }, [activeTabIndex]);

  // Jump to a message: pin the highlight and place the message top at the
  // cursor line, so the just-clicked bar stays highlighted until the user
  // scrolls (same as ZCode's scrollToMessage).
  const select = (idx: number) => {
    const chat = scrollRef.current;
    if (!chat) return;
    const row = chat.querySelectorAll('.message-row.user')[idx] as HTMLElement | undefined;
    if (!row) return;
    pinnedRef.current = true;
    const rect = row.getBoundingClientRect();
    const chatRect = chat.getBoundingClientRect();
    const top = rect.top - chatRect.top + chat.scrollTop - CURSOR_LINE;
    chat.scrollTo({ top: Math.max(0, top) });
    activeRef.current = idx;
    setActive(idx);
  };

  // ZCode's mod+alt+[ / mod+alt+] — previous / next user message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !(e.ctrlKey || e.metaKey)) return;
      if (e.key !== '[' && e.key !== ']') return;
      const state = useStore.getState();
      const msgs = state.tabs[state.activeTabIndex]?.messages.filter((m) => m.role === 'user');
      if (!msgs || msgs.length === 0) return;
      const cur = activeRef.current >= 0 ? activeRef.current : msgs.length - 1;
      const target = e.key === '[' ? Math.max(0, cur - 1) : Math.min(msgs.length - 1, cur + 1);
      e.preventDefault();
      select(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTabIndex]);

  if (userCount < 2 || hidden || markers.length === 0) return null;

  return (
    <div className="msg-nav" ref={railRef}>
      {markers.map((m) => (
        <button
          key={m.idx}
          type="button"
          className={`msg-nav-marker${m.idx === active ? ' active' : ''}`}
          style={{ top: `${(m.frac * 100).toFixed(2)}%` }}
          aria-label={`跳转到第 ${m.idx + 1} 条消息`}
          onClick={() => select(m.idx)}
          onMouseEnter={() => showPreview(m.idx)}
          onMouseLeave={scheduleHide}
          onFocus={() => showPreview(m.idx)}
          onBlur={scheduleHide}
        />
      ))}
      {hover >= 0 && markers[hover] && userMsgs[hover] && (
        <div
          ref={popRef}
          className="msg-nav-pop md"
          role="tooltip"
          onMouseEnter={() => window.clearTimeout(hideTimerRef.current)}
          onMouseLeave={scheduleHide}
          onPointerDown={() => {
            suppressHideRef.current = true;
          }}
          onPointerUp={() => {
            suppressHideRef.current = false;
            if (popRef.current?.matches(':hover')) {
              window.clearTimeout(hideTimerRef.current);
            } else {
              scheduleHide();
            }
          }}
        >
          <Suspense fallback={<div>{userMsgs[hover].content.map(partText).join('\n')}</div>}>
            <Markdown text={userMsgs[hover].content.map(partText).join('\n')} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
