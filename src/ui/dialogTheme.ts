import { READING_STATS_PALETTE } from "./palette";

/** Shared tokens for standalone reading windows, outside Zotero's stylesheet. */
export function dialogThemeCSS(): string {
  const { light, dark } = READING_STATS_PALETTE;
  return `
    :root { --zest-focus:AccentColor; }
    /* Keep rem sizing independent of the native chrome stylesheet's font. */
    :root { font-size:16px; color-scheme:light dark; --zest-bg:#f2f2f2; --zest-surface:#ffffff; --zest-fg:rgba(0,0,0,.85); --zest-muted:rgba(0,0,0,.55); --zest-line:rgba(0,0,0,.15); --zest-fill:#e6e6e6; --zest-shadow:0 2px 8px #00000004,0 12px 28px #00000003; --zest-stats-blue:${light.blue}; --zest-stats-violet:${light.violet}; --zest-stats-bronze:${light.bronze}; --zest-accent:var(--zest-stats-blue); }
    @media(prefers-color-scheme:dark) { :root { --zest-bg:#303030; --zest-surface:#1e1e1e; --zest-fg:rgba(255,255,255,.9); --zest-muted:rgba(255,255,255,.55); --zest-line:rgba(255,255,255,.18); --zest-fill:#3c3c3c; --zest-shadow:0 4px 20px #00000014; --zest-stats-blue:${dark.blue}; --zest-stats-violet:${dark.violet}; --zest-stats-bronze:${dark.bronze}; } }
  `;
}

type SidebarThemeBinding = {
  setActive(active: boolean): void;
  dispose(): void;
};
const bindings = new WeakMap<Window, SidebarThemeBinding>();
const sidebarTokens = {
  "--zest-bg": "--material-sidepane",
  "--zest-surface": "--material-background",
  "--zest-fg": "--fill-primary",
  "--zest-muted": "--fill-secondary",
  "--zest-line": "--color-border",
  "--zest-fill": "--color-quinary-on-sidepane",
  "--zest-focus": "--color-focus-border",
};

/** Bridge only neutral tokens, not Zotero's global control styles, into a frame. */
export function bindSidebarTheme(
  win: Window,
  body: HTMLElement,
): SidebarThemeBinding {
  const root = win.document?.documentElement as HTMLElement | null;
  const host = body.ownerDocument?.defaultView;
  bindings.get(win)?.dispose();
  if (!root?.style || typeof host?.getComputedStyle !== "function")
    return { setActive() {}, dispose() {} };
  let active = true;
  let dirty = true;
  let disposed = false;
  let media: MediaQueryList | undefined;
  try {
    media = host.matchMedia?.("(prefers-color-scheme: dark)") ?? undefined;
  } catch {
    // Native neutral CSS remains usable without a media-query API.
  }
  const owned = new Map<
    string,
    { before: string; priority: string; value: string }
  >();
  const owns = (name: string, value: string) =>
    root.style.getPropertyValue(name) === value &&
    root.style.getPropertyPriority(name) === "";
  const restore = (name: string) => {
    const entry = owned.get(name);
    if (!entry) return;
    if (owns(name, entry.value)) {
      if (entry.before)
        root.style.setProperty(name, entry.before, entry.priority);
      else root.style.removeProperty(name);
    }
    owned.delete(name);
  };
  const write = (name: string, value: string) => {
    if (!value) {
      restore(name);
      return;
    }
    const previous = owned.get(name);
    // A later owner may deliberately override just one token.
    if (previous && !owns(name, previous.value)) return;
    if (!previous)
      owned.set(name, {
        before: root.style.getPropertyValue(name),
        priority: root.style.getPropertyPriority(name),
        value,
      });
    else previous.value = value;
    root.style.setProperty(name, value);
  };
  const sync = () => {
    if (
      disposed ||
      !active ||
      !dirty ||
      win.closed ||
      host.closed ||
      win.document.documentElement !== root
    )
      return;
    try {
      const style = host.getComputedStyle(body);
      if (!style) return;
      for (const [name, native] of Object.entries(sidebarTokens))
        write(name, style.getPropertyValue(native).trim());
      write("--zest-shadow", "none");
      const scheme = media
        ? media.matches
          ? "dark"
          : "light"
        : style.getPropertyValue("color-scheme").trim();
      write("color-scheme", /^(light|dark)$/.test(scheme) ? scheme : "");
      dirty = false;
    } catch (e) {
      ztoolkit.log("[sidebar theme] native tokens unavailable", e);
    }
  };
  const changed = () => {
    if (disposed) return;
    dirty = true;
    sync();
  };
  const binding: SidebarThemeBinding = {
    setActive(value) {
      if (disposed) return;
      active = value;
      sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      media?.removeEventListener?.("change", changed);
      for (const name of owned.keys()) restore(name);
      if (bindings.get(win) === binding) bindings.delete(win);
    },
  };
  bindings.set(win, binding);
  media?.addEventListener?.("change", changed);
  sync();
  return binding;
}
