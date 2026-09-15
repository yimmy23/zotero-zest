/** Main-window tab navigation uses Zotero's palette in both themes. */
export const TABS_SIDEBAR_STYLES = `
  .zest-tabbar { display: flex; flex-direction: column; min-width: 160px; overflow: hidden;
    background-color: var(--material-sidepane, var(--material-background, transparent));
    border-inline-end: 1px solid var(--fill-quinary); }
  .zest-tabbar-splitter { border: 0; background-color: var(--fill-quinary); min-width: 1px; }
  .zest-tabbar-head { display: flex; gap: 4px; padding: 7px 6px; align-items: center; flex-wrap: nowrap;
    border-bottom: 1px solid var(--fill-quinary); }
  .zest-tabbar-search { flex: 1 1 auto; min-width: 0; padding: 4px 7px; border-radius: var(--zest-control-radius);
    border: 1px solid var(--fill-quinary); background-color: var(--material-background, transparent);
    color: var(--fill-primary); font-size: calc(var(--zotero-font-size, 13px) * .923); }
  .zest-tabbar button { appearance: none; min-width: 0; margin: 0; border: 0;
    background: transparent; color: inherit; cursor: pointer; font: inherit; }
  .zest-tabbar .zest-tabbar-btn { border-radius: var(--zest-control-radius); padding: 1px 6px; color: var(--fill-secondary); }
  .zest-tabbar-btn:hover { background-color: var(--fill-quinary); }
  .zest-tabbar .zest-tabbar-library { flex: 0 0 auto; text-align: start; margin: 5px 4px 3px;
    padding: 7px 8px; border-radius: var(--zest-control-radius); color: var(--fill-primary); }
  .zest-tabbar-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 3px 0 8px; }
  .zest-tabbar .zest-tabbar-group { display: flex; align-items: center; gap: 4px; width: 100%;
    padding: 7px 8px 4px; color: var(--fill-secondary); text-align: start;
    font-size: calc(var(--zotero-font-size, 13px) * .846); }
  .zest-tabbar-group-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .zest-tabbar-group:hover, .zest-tabbar-library:hover { background-color: var(--fill-quinary); }
  .zest-tabbar-row { display: flex; align-items: center; gap: 3px; padding: 0 4px 0 0;
    border-radius: var(--zest-control-radius); margin: 0 4px; font-size: calc(var(--zotero-font-size, 13px) * .923); }
  .zest-tabbar-row:hover { background-color: var(--fill-quinary); }
  .zest-tabbar-row.selected, .zest-tabbar .zest-tabbar-library.selected {
    background-color: var(--zest-accent-wash-strong); color: var(--fill-primary); font-weight: 600; }
  .zest-tabbar .zest-tabbar-tab { display: flex; flex: 1 1 auto; min-width: 0;
    padding: 6px 4px 6px 8px; border-radius: var(--zest-control-radius); text-align: start; }
  .zest-tabbar-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .zest-tabbar .zest-tabbar-close { flex: 0 0 auto; opacity: 0; padding: 3px; border-radius: var(--zest-control-radius); }
  .zest-tabbar-row:hover .zest-tabbar-close, .zest-tabbar-row:focus-within .zest-tabbar-close { opacity: .7; }
  .zest-tabbar .zest-tabbar-close:hover, .zest-tabbar .zest-tabbar-close:focus-visible { opacity: 1; }
  .zest-tabbar :is(button, input):focus-visible { outline: 2px solid var(--zest-accent-strong); outline-offset: -2px; }
  .zest-tabbar-empty { padding: 12px; color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .923); }
  :root.zest-hide-native-tabs #tab-bar-container > div { display: none !important; }
`;
