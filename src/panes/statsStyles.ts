import { dialogThemeCSS } from "../ui/dialogTheme";
import { ICON_CSS } from "../ui/icons";

export function statsCSS() {
  return `
    ${dialogThemeCSS()}
    ${ICON_CSS}
    .zest-stats { max-width:1240px; margin:auto; padding:28px 32px; line-height:1.5; }
    .zest-stats-header { display:flex; justify-content:space-between; align-items:center; gap:18px; margin-bottom:24px; }
    h1 { font-size:1.5rem; margin:0; display:flex; align-items:center; gap:10px; letter-spacing:-.035em; font-weight:650; }
    h1 .zest-icon { width:22px; height:22px; }
    h2 { font-size:.94rem; margin:0 0 16px; font-weight:600; letter-spacing:.015em; }
    h3 { font-size:.87rem; margin:0; font-weight:600; }
    .zest-stats-subtitle { color:var(--zest-muted); margin:6px 0 0; font-size:.78rem; }
    .zest-stats-summary { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); padding:18px 0; margin-top:18px; border-radius:16px; background:var(--zest-surface); box-shadow:var(--zest-shadow); }
    .zest-goals-layout { display:grid; grid-template-columns:220px minmax(0,1fr); align-items:center; gap:36px; }
    .zest-rings { display:block; position:relative; width:220px; height:220px; }
    .zest-rings svg { width:100%; height:100%; transform:rotate(-90deg); }
    .zest-rings circle { fill:none; stroke-width:9; }
    .zest-ring-track { stroke:var(--zest-fill); }
    .zest-ring-0 { --ring-color:var(--zest-stats-blue); }
    .zest-ring-1 { --ring-color:var(--zest-stats-violet); }
    .zest-ring-2 { --ring-color:var(--zest-stats-bronze); }
    .zest-ring-progress { stroke:var(--ring-color); stroke-linecap:round; }
    .zest-rings-centre { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; }
    .zest-rings-centre strong { font-size:1.6rem; font-weight:600; letter-spacing:-.04em; font-variant-numeric:tabular-nums; }
    .zest-rings-centre .zest-stats-label { font-size:.72rem; margin-bottom:3px; }
    .zest-goal-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px; }
    .zest-goal-line { display:flex; flex-direction:column; gap:8px; }
    .zest-goal-line strong { display:block; font-weight:600; font-variant-numeric:tabular-nums; }
    .zest-goal-amount { display:block; font-size:1.08rem; letter-spacing:-.03em; overflow-wrap:anywhere; }
    .zest-goal-target { display:block; font-size:.75rem; font-weight:400; color:var(--zest-muted); margin-top:2px; }
    .zest-goal-name { color:var(--zest-muted); font-size:.75rem; }
    .zest-goal-name::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px; background:var(--ring-color); }
    .zest-goal-metric progress { appearance:none; display:block; width:100%; height:3px; border:0; border-radius:3px; overflow:hidden; background:var(--zest-fill); margin:10px 0 6px; }
    .zest-goal-metric progress::-moz-progress-bar { background:var(--ring-color); border-radius:3px; }
    .zest-goal-detail { display:block; color:var(--zest-muted); font-size:.7rem; overflow-wrap:anywhere; }
    .zest-goal-week { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:7px; margin-top:20px; padding-top:16px; border-top:1px solid var(--zest-line); }
    .zest-goal-day { display:flex; flex-direction:column; align-items:center; gap:6px; padding:0 2px; font-size:.72rem; color:var(--zest-muted); }
    .zest-goal-day strong { display:grid; place-items:center; width:30px; height:30px; border-radius:50%; background:var(--zest-fill); font-size:.82rem; font-weight:500; }
    .zest-goal-day.is-today strong { outline:1px solid var(--zest-stats-bronze); outline-offset:3px; }
    .zest-goal-day.is-achieved strong { color:var(--zest-fg); background:color-mix(in srgb,var(--zest-stats-bronze) 20%,var(--zest-surface)); }
    .zest-goal-day.is-future strong { background:transparent; }
    .zest-goal-controls { display:flex; gap:16px; flex-wrap:wrap; margin-top:14px; }
    .zest-goal-controls label { display:flex; gap:8px; align-items:center; font-size:.75rem; color:var(--zest-muted); }
    .zest-goal-controls select { font-size:.75rem; padding:4px 28px 4px 7px; }
    .zest-stats-card { padding:2px 20px; min-width:0; }
    .zest-stats-card + .zest-stats-card { border-left:1px solid var(--zest-line); }
    .zest-stats-value { font-size:1.55rem; font-weight:600; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; letter-spacing:-.035em; }
    .zest-stats-label { color:var(--zest-muted); font-size:.73rem; margin-top:4px; }
    .zest-stats-note { color:var(--zest-muted); font-size:.74rem; margin:10px 0; line-height:1.6; }
    .zest-stats-notice { border-left:3px solid var(--zest-accent); background:var(--zest-fill); padding:10px 14px; font-size:.82rem; border-radius:0 7px 7px 0; }
    .zest-stats-panel { min-width:0; padding:24px; margin-top:18px; border:1px solid color-mix(in srgb,var(--zest-line) 65%,var(--zest-surface)); border-radius:16px; background:var(--zest-surface); box-shadow:var(--zest-shadow); }
    .zest-stats-charts { display:grid; grid-template-columns:minmax(0,1.9fr) minmax(260px,1fr); gap:18px; }
    .zest-trend-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .zest-trend-header h2 { margin:0; }
    .zest-stats-ranges { display:inline-flex; gap:2px; padding:3px; background:var(--zest-fill); border-radius:9px; }
    .zest-stats-ranges button { background:transparent; color:var(--zest-muted); border-color:transparent; padding:4px 9px; font-size:.73rem; }
    .zest-stats-ranges [aria-pressed=true] { background:var(--zest-surface); color:var(--zest-fg); box-shadow:0 1px 3px #0000000d; font-weight:600; }
    .zest-stats-period { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:24px 0 8px; }
    .zest-stats-period .zest-stats-value { font-size:1.25rem; }
    .zest-stats-trend { display:block; width:100%; height:auto; overflow:visible; }
    .zest-stats-trend text { font:11px system-ui,sans-serif; fill:var(--zest-muted); }
    .zest-trend-grid { stroke:var(--zest-line); stroke-width:1; stroke-dasharray:3 5; }
    .zest-trend-area { fill:var(--zest-accent); opacity:.07; }
    .zest-trend-line { fill:none; stroke:var(--zest-accent); stroke-width:2.25; stroke-linejoin:round; }
    .zest-trend-dot { fill:var(--zest-accent); }
    .zest-stats-data { font-size:.78rem; color:var(--zest-muted); }
    .zest-stats-data summary { cursor:pointer; width:fit-content; }
    .zest-stats-data[open] { max-height:330px; overflow:auto; }
    .zest-stats-weekdays { list-style:none; padding:0; margin:20px 0 0; }
    .zest-weekday { display:grid; grid-template-columns:38px minmax(0,1fr) 72px; gap:9px; align-items:center; margin:15px 0; font-size:.79rem; }
    .zest-weekday-track { height:5px; border-radius:4px; background:var(--zest-fill); overflow:hidden; }
    .zest-weekday-bar { height:100%; border-radius:4px; background:var(--zest-stats-violet); }
    .zest-weekday-time { text-align:right; color:var(--zest-muted); font-variant-numeric:tabular-nums; }
    .zest-cal-wrap { overflow-x:auto; padding:28px 0 4px; }
    .zest-cal { display:grid; grid-template-columns:repeat(53,12px); gap:3px; width:max-content; }
    .zest-cal-week { position:relative; display:flex; flex-direction:column; gap:3px; }
    .zest-cal-cell { display:block; flex-shrink:0; width:12px; height:12px; border-radius:3px; }
    .zest-cal-month { position:absolute; top:-24px; left:0; font-size:.7rem; color:var(--zest-muted); white-space:nowrap; }
    .zest-cal-footer { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
    .zest-cal-legend { display:flex; align-items:center; gap:4px; font-size:.72rem; color:var(--zest-muted); }
    .zest-achievements { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:18px 0 14px; }
    .zest-achievement { --achievement-color:var(--zest-stats-blue); display:grid; grid-template-columns:58px minmax(0,1fr); column-gap:14px; row-gap:5px; align-content:start; padding:18px; border:1px solid var(--zest-line); border-radius:12px; min-width:0; }
    .zest-achievement[data-metric=items] { --achievement-color:var(--zest-stats-violet); }
    .zest-achievement[data-metric=days] { --achievement-color:var(--zest-stats-bronze); }
    .zest-achievement.is-unlocked { border-color:color-mix(in srgb,var(--zest-line) 60%,var(--zest-surface)); background:linear-gradient(135deg,color-mix(in srgb,var(--achievement-color) 4%,var(--zest-surface)),var(--zest-surface) 70%); }
    .zest-achievement-heading { grid-column:2; grid-row:2; display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; overflow-wrap:anywhere; }
    .zest-achievement-category { grid-column:1 / -1; font-size:.72rem; color:var(--zest-muted); margin-bottom:10px; }
    .zest-achievement.is-next { border-color:color-mix(in srgb,var(--achievement-color) 50%,var(--zest-line)); }
    .zest-medal { grid-column:1; grid-row:2 / 4; position:relative; display:block; width:58px; height:70px; margin:3px 0 0; }
    .zest-medal-art { display:block; width:58px; height:58px; object-fit:contain; filter:grayscale(1); opacity:.5; }
    .is-unlocked .zest-medal-art { filter:none; opacity:1; }
    .zest-medal-target { position:absolute; bottom:0; left:50%; transform:translateX(-50%); min-width:30px; padding:1px 5px; border:1px solid var(--zest-line); border-radius:6px; background:var(--zest-surface); color:var(--zest-muted); font:600 11px system-ui,sans-serif; text-align:center; white-space:nowrap; }
    .is-unlocked .zest-medal-target { color:var(--zest-fg); }
    .zest-achievement-status { font-size:.72rem; color:var(--zest-muted); }
    .is-unlocked .zest-achievement-status { color:var(--zest-fg); }
    .zest-achievement-rule { grid-column:2; grid-row:3; font-size:.73rem; color:var(--zest-muted); margin:0; min-height:3em; line-height:1.5; overflow-wrap:anywhere; }
    .zest-achievement progress { grid-column:1 / -1; appearance:none; display:block; width:100%; height:3px; margin-top:10px; border:none; border-radius:3px; overflow:hidden; background:var(--zest-fill); accent-color:var(--achievement-color); }
    .zest-achievement progress::-moz-progress-bar { background:var(--achievement-color); border-radius:3px; }
    .zest-achievement-current { grid-column:1 / -1; font-size:.72rem; text-align:right; color:var(--zest-muted); margin-top:2px; font-variant-numeric:tabular-nums; }
    .zest-stats-table { width:100%; border-collapse:collapse; font-size:.82rem; color:var(--zest-fg); }
    .zest-stats-table th,.zest-stats-table td { padding:10px 6px; border-bottom:1px solid var(--zest-line); text-align:left; vertical-align:top; }
    .zest-stats-table th { font-size:.75rem; font-weight:500; color:var(--zest-muted); }
    .zest-stats-table tr:last-child td { border-bottom:none; }
    .zest-stats-top td:not(:first-child) { white-space:nowrap; font-variant-numeric:tabular-nums; }
    .zest-stats-item { width:72%; overflow-wrap:anywhere; }
    .zest-stats-item-bar { height:4px; margin-top:8px; border-radius:3px; background:var(--zest-accent); opacity:.3; }
    .zest-stats-source { margin:18px 0 0; }
    @media(max-width:960px) { .zest-achievements { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media(max-width:820px) { .zest-stats-summary { grid-template-columns:repeat(3,minmax(0,1fr)); row-gap:20px; } .zest-stats-card:nth-child(4) { border-left:0; } .zest-stats-charts { grid-template-columns:minmax(0,1fr); } }
    @media(max-width:700px) { .zest-goals-layout { grid-template-columns:minmax(0,1fr); gap:16px; } .zest-rings { margin:auto; } }
    @media(max-width:560px) { .zest-stats { padding:16px; } .zest-stats-panel { padding:18px; } .zest-achievements { grid-template-columns:minmax(0,1fr); } .zest-stats-header { align-items:flex-start; } .zest-stats-card { padding:2px 12px; } .zest-stats-value { font-size:1.25rem; } .zest-goal-metrics { grid-template-columns:minmax(0,1fr); gap:18px; } .zest-goal-metric { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); column-gap:12px; } .zest-goal-line { display:contents; } .zest-goal-name { grid-column:1; grid-row:1; align-self:center; } .zest-goal-line strong,.zest-goal-metric progress,.zest-goal-detail { grid-column:2; } .zest-goal-amount { font-size:.94rem; } }
    @media(max-width:380px) { .zest-goal-week { gap:3px; } .zest-goal-day strong { width:26px; height:26px; } }
    /* The sidebar is an entry point, not a second scrolling dashboard. */
    .zest-stats-embedded { max-width:100%; padding:4px; display:flex; justify-content:center; }
    .zest-stats-open-details { appearance:none; display:block; width:min(172px,100%); margin:0; padding:8px; border:1px solid transparent; border-radius:var(--zest-control-radius,8px); background:transparent; color:inherit; font:inherit; cursor:pointer; }
    .zest-stats-open-details:hover { background:var(--zest-fill); border-color:var(--zest-line); }
    .zest-stats-open-details:active { background:var(--zest-surface); }
    .zest-stats-embedded .zest-rings { width:100%; height:auto; aspect-ratio:1; margin:0; }
    .zest-stats-embedded .zest-rings-centre strong { font-size:1.05em; font-weight:550; line-height:1.3; letter-spacing:0; }
    .zest-stats-embedded .zest-rings-centre .zest-stats-label { font-size:.75em; line-height:1.3; margin:0 0 3px; }
  `;
}
