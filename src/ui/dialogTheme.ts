import { READING_STATS_PALETTE } from "./palette";

/** Shared tokens for standalone reading windows, outside Zotero's stylesheet. */
export function dialogThemeCSS(): string {
  const { light, dark } = READING_STATS_PALETTE;
  return `
    :root { color-scheme:light dark; --zest-bg:#f5f4f1; --zest-surface:#fffefa; --zest-fg:#252831; --zest-muted:#65676f; --zest-line:#e5e3df; --zest-fill:#eeedea; --zest-shadow:0 2px 8px #25283104,0 12px 28px #25283103; --zest-stats-blue:${light.blue}; --zest-stats-violet:${light.violet}; --zest-stats-bronze:${light.bronze}; --zest-accent:var(--zest-stats-blue); }
    @media(prefers-color-scheme:dark) { :root { --zest-bg:#181c24; --zest-surface:#222731; --zest-fg:#edeef2; --zest-muted:#aeb5c2; --zest-line:#383f4d; --zest-fill:#303744; --zest-shadow:0 4px 20px #00000014; --zest-stats-blue:${dark.blue}; --zest-stats-violet:${dark.violet}; --zest-stats-bronze:${dark.bronze}; } }
  `;
}
