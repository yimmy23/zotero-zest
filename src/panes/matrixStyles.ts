import { dialogThemeCSS } from "../ui/dialogTheme";
import { ICON_CSS } from "../ui/icons";

export function matrixCSS(): string {
  return `${dialogThemeCSS()} ${ICON_CSS}
    .zest-matrix, .zest-matrix * { user-select:text; -moz-user-select:text; }
    button,select,summary { user-select:none !important; }
    .zest-matrix { max-width:1240px; margin:auto; padding:26px 30px; line-height:1.5; height:100vh; min-height:540px; display:flex; flex-direction:column; }
    .zest-matrix > * { flex-shrink:0; }
    .zest-matrix-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:22px; }
    h1 { margin:0; font-size:1.5rem; font-weight:650; letter-spacing:-.035em; }
    .zest-matrix-subtitle { margin:5px 0 0; color:var(--zest-muted); font-size:.8rem; }
    .zest-matrix-actions, .zest-matrix-bar, .zest-matrix-results-bar, .zest-matrix-row-actions { display:flex; gap:10px; align-items:center; }
    .zest-matrix-actions { margin-inline-start:auto; flex-shrink:0; }
    .zest-matrix-tools { border:1px solid var(--zest-line); border-radius:12px; background:var(--zest-surface); padding:10px; }
    .zest-matrix-search { flex:1; width:0; min-width:100px; background:var(--zest-bg); border-color:transparent; }
    .zest-matrix-scope { max-width:13em; }
    .zest-matrix-filter-toggle { flex-shrink:0; }
    .zest-matrix-filters { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; padding:14px 2px 2px; }
    .zest-matrix-field { display:flex; flex-direction:column; gap:5px; font-size:.76rem; color:var(--zest-muted); min-width:0; }
    .zest-matrix-field select { color:var(--zest-fg); width:100%; }
    .zest-matrix-search-help { grid-column:1/-1; color:var(--zest-muted); font-size:.74rem; margin:0; }
    .zest-matrix-results-bar { flex-wrap:wrap; margin:16px 0 12px; font-size:.78rem; color:var(--zest-muted); }
    .zest-matrix-count { margin-inline-end:auto; font-variant-numeric:tabular-nums; }
    .zest-matrix-comments-label { display:flex; align-items:center; gap:5px; cursor:pointer; }
    .zest-matrix-sort { font-size:.76rem; background-color:transparent; padding:4px 25px 4px 6px; border-color:transparent; }
    .zest-matrix-reset { font-size:.76rem; border-color:transparent; background:transparent; padding:4px 6px; color:var(--zest-accent); }
    .zest-matrix-status { color:var(--zest-accent); font-size:.8rem; margin:0 0 10px; overflow-wrap:anywhere; }
    .zest-matrix-status:empty { display:none; }
    .zest-matrix-list { border:1px solid var(--zest-line); border-radius:14px; background:var(--zest-surface); box-shadow:var(--zest-shadow); flex:1; min-height:160px; overflow:auto; scrollbar-width:thin; }
    .zest-matrix-row { display:grid; grid-template-columns:minmax(140px,22%) minmax(0,1fr); gap:28px; padding:22px 24px; }
    .zest-matrix-row + .zest-matrix-row { border-top:1px solid var(--zest-line); }
    .zest-matrix-source { min-width:0; }
    .zest-matrix-item-title { display:block; padding:0; background:none; border:0; border-radius:var(--zest-control-radius,8px); text-align:start; font-size:.82rem; font-weight:550; line-height:1.6; overflow-wrap:anywhere; }
    .zest-matrix-item-title:hover { color:var(--zest-accent); background:none; }
    .zest-matrix-attachment { margin:7px 0 0; font-size:.72rem; line-height:1.5; color:var(--zest-muted); overflow-wrap:anywhere; }
    .zest-matrix-content { min-width:0; }
    .zest-matrix-meta { display:flex; align-items:center; gap:12px; flex-wrap:wrap; color:var(--zest-muted); font-size:.73rem; margin-bottom:8px; }
    .zest-matrix-type::before { content:""; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--annotation-color,var(--zest-muted)); margin-inline-end:7px; box-shadow:0 0 0 2px var(--zest-fill); }
    .zest-matrix-text,.zest-matrix-comment p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; font-size:.94rem; margin:0; }
    .zest-matrix-comment { margin-top:12px; padding:10px 14px; border-inline-start:2px solid var(--zest-stats-violet); background:color-mix(in srgb,var(--zest-stats-violet) 6%,var(--zest-surface)); border-radius:0 8px 8px 0; }
    .zest-matrix-comment-label { display:block; font-size:.7rem; color:var(--zest-muted); margin-bottom:3px; }
    .zest-matrix-no-text { color:var(--zest-muted); font-size:.84rem; margin:0; }
    .zest-matrix-expand { color:var(--zest-accent); border:0; padding:4px 0; font-size:.76rem; background:none; margin-top:4px; }
    .zest-matrix-row-foot { display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px; align-items:center; margin-top:14px; }
    .zest-matrix-tags { display:flex; gap:5px; flex-wrap:wrap; min-width:0; flex:1 1 10rem; }
    .zest-matrix-tag-chip { font-size:.69rem; color:var(--zest-muted); padding:2px 7px; border:0; background:var(--zest-fill); border-radius:var(--zest-control-radius,8px); white-space:normal; overflow-wrap:anywhere; max-width:100%; }
    .zest-matrix-row-actions { gap:5px; margin-inline-start:auto; flex-wrap:wrap; max-width:100%; }
    .zest-matrix-row-actions button { font-size:.73rem; padding:4px 8px; }
    .zest-matrix-copy { border-color:transparent; background:transparent; color:var(--zest-muted); }
    .zest-matrix-open { color:var(--zest-accent); }
    .zest-matrix-export { position:relative; }
    .zest-matrix-export summary { white-space:nowrap; }
    .zest-matrix-export-menu { position:absolute; inset-inline-end:0; top:calc(100% + 8px); width:245px; max-width:calc(100vw - 32px); padding:14px; z-index:3; background:var(--zest-surface); border:1px solid var(--zest-line); border-radius:12px; box-shadow:var(--zest-shadow); display:flex; flex-direction:column; gap:10px; }
    .zest-matrix-export-menu p { margin:0 0 4px; }
    .zest-matrix-empty { text-align:center; padding:52px 20px; color:var(--zest-muted); }
    .zest-matrix-empty h2 { font-size:1rem; color:var(--zest-fg); font-weight:550; margin:0 0 8px; }
    .zest-matrix-empty p { font-size:.82rem; margin:0; }
    .zest-matrix-pager { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding:16px 0 2px; }
    .zest-matrix-range { margin-inline-end:auto; font-size:.78rem; color:var(--zest-muted); font-variant-numeric:tabular-nums; }
    @media(max-width:700px) {
      .zest-matrix { padding:20px 16px; }
      .zest-matrix-header { align-items:flex-start; flex-wrap:wrap; margin-bottom:10px; }
      .zest-matrix-subtitle { display:none; }
      .zest-matrix-row { grid-template-columns:minmax(0,1fr); gap:12px; padding:18px; }
      .zest-matrix-source { padding-bottom:10px; border-bottom:1px solid var(--zest-line); }
      .zest-matrix-attachment { margin-top:3px; }
      .zest-matrix-filters { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .zest-matrix-bar { flex-wrap:wrap; }
      .zest-matrix-search { order:-1; width:100%; flex-basis:100%; }
      .zest-matrix-scope { flex:1; max-width:none; }
      .zest-matrix-results-bar { margin:8px 0; gap:6px; }
    }
    @media(max-width:380px) {
      .zest-matrix-filters { grid-template-columns:minmax(0,1fr); }
      .zest-matrix { padding:16px 12px; }
      .zest-matrix-pager { flex-wrap:wrap; }
      .zest-matrix-range { flex-basis:100%; }
    }
    .zest-matrix.zest-matrix-embedded { padding:8px; min-height:0; max-width:none; overflow:auto; }
    .zest-matrix-embedded .zest-matrix-heading { display:none; }
    .zest-matrix-embedded .zest-matrix-header { margin-bottom:8px; gap:8px; }
    .zest-matrix-embedded .zest-matrix-actions { gap:6px; }
    .zest-matrix-embedded .zest-matrix-tools { padding:8px; border-radius:10px; }
    .zest-matrix-embedded .zest-matrix-bar { gap:6px; }
    .zest-matrix-embedded .zest-flat-btn { padding:5px 9px; }
    .zest-matrix-embedded .zest-matrix-search { padding:8px; }
    .zest-matrix-embedded .zest-matrix-results-bar { margin:10px 0 8px; gap:6px; }
    .zest-matrix-embedded .zest-matrix-list { min-height:0; border-radius:10px; }
    .zest-matrix-embedded .zest-matrix-row { padding:12px; gap:10px; }
    .zest-matrix-embedded .zest-matrix-source { padding-bottom:8px; }
    .zest-matrix-embedded .zest-matrix-item-title { padding:0; }
    .zest-matrix-embedded .zest-matrix-text,.zest-matrix-embedded .zest-matrix-comment p { font-size:.86rem; line-height:1.7; }
    .zest-matrix-embedded .zest-matrix-comment { padding:8px 10px; }
    .zest-matrix-embedded .zest-matrix-pager { padding:10px 0 0; gap:6px; }
    .zest-matrix-embedded .zest-matrix-empty { padding:24px 12px; }
  `;
}
