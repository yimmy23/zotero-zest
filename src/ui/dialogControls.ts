/** Shared native-themed controls for Zest-owned HTML windows and frames. */
export const DIALOG_CONTROLS_CSS = `
  * { box-sizing:border-box; }
  body { margin:0; background:var(--zest-bg); color:var(--zest-fg); font:var(--zest-body-font,14px) system-ui,sans-serif; }
  [hidden] { display:none !important; }
  button, summary { border-radius:var(--zest-control-radius,8px); }
  .zest-flat-btn,.zest-flat-input,.zest-flat-select { color:var(--zest-fg); font:inherit; font-size:.82rem; border:1px solid var(--zest-line); border-radius:var(--zest-control-radius,8px); background-color:var(--zest-surface); box-shadow:none; margin:0; max-width:100%; }
  .zest-flat-btn { appearance:none; display:inline-flex; align-items:center; justify-content:center; gap:5px; padding:6px 12px; cursor:pointer; line-height:1.5; overflow-wrap:anywhere; }
  .zest-flat-btn:hover { background-color:var(--zest-fill); }
  button:disabled { opacity:.55; cursor:default; }
  :focus-visible { outline:2px solid var(--zest-focus); outline-offset:3px; }
  .zest-flat-input { min-width:0; padding:8px 10px; }
  .zest-flat-select { appearance:none; padding:8px 28px 8px 9px; min-width:0; background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%); background-position:right 12px center,right 8px center; background-size:4px 4px,4px 4px; background-repeat:no-repeat; }
  input[type=checkbox] { accent-color:var(--zest-accent); }
`;
