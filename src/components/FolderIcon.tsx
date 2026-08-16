/**
 * Animated folder glyph — the DeepSeek Harness workspace-browser pattern
 * (`IconFolderClose16` ⇄ `IconFolderOpen16`): closed when collapsed, open
 * when expanded, all in one SVG whose front face drops to open the mouth
 * and whose tab swings up while the back wall stays put. State changes are
 * pure CSS transitions (see `.fld` in theme.css), so no JS animation loop,
 * and `prefers-reduced-motion` disables the motion.
 */
export function FolderIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`fld${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {/* Back wall: the closed-folder silhouette, always visible. Its top
          strip (y 6.5 → face top) is the folder mouth, which widens when
          the face drops. */}
      <path
        className="fld-back"
        d="M1.25 6.5 V5.4 a1.5 1.5 0 0 1 1.5 -1.5 h4.05 l1.1 2.6 h6.35 a1.5 1.5 0 0 1 1.5 1.5 v4.85 a2 2 0 0 1 -2 2 h-10.5 a2 2 0 0 1 -2 -2 Z"
      />
      {/* Front face + tab: together they form the closed folder; when open
          the group drops 1.8px (mouth opens) and the tab swings up. */}
      <g className="fld-face">
        <path
          className="fld-front"
          d="M1.25 8.1 h13.5 v4.75 a2 2 0 0 1 -2 2 h-9.5 a2 2 0 0 1 -2 -2 Z"
        />
        <path
          className="fld-tab"
          d="M1.25 6.5 V5.4 a1.5 1.5 0 0 1 1.5 -1.5 h4.05 l1.1 2.6 Z"
        />
      </g>
    </svg>
  );
}
