import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

/**
 * Annotation colour schemes.
 *
 * Zotero's highlight palette is eight fixed colours, and there is no API to
 * rename or replace them — the reader builds that list from a module-level
 * constant. What a plugin CAN do is offer its own palettes and set the current
 * tool's colour, which is what people actually want ("give me the three colours
 * I use for this project").
 *
 * Two menu surfaces, with different capabilities (both verified in 9.0.6/10.0):
 *   createColorContextMenu / createAnnotationContextMenu — the in-iframe React
 *     menu: FLAT rows only, `groups` is ignored, and rows need `persistent`
 *     or they are filtered out;
 *   createViewContextMenu — the native XUL menu: real submenus via `groups`,
 *     but it throws if a top-level item carries `icon` or `slider`.
 *
 * `unregisterEventListener` is never called: in 9.0.6 its filter is inverted
 * and removes every OTHER plugin's listeners too. Listeners are cheap and
 * Zotero drops them when the plugin shuts down.
 */

export interface ColorScheme {
  id: string;
  labelID:
    "reader-scheme-classic" | "reader-scheme-warm" | "reader-scheme-cool";
  colors: string[];
}

export const SCHEMES: ColorScheme[] = [
  {
    id: "classic",
    labelID: "reader-scheme-classic",
    colors: ["#ffd400", "#ff6666", "#5fb236"],
  },
  {
    id: "warm",
    labelID: "reader-scheme-warm",
    colors: ["#f19837", "#ff6666", "#a6507b"],
  },
  {
    id: "cool",
    labelID: "reader-scheme-cool",
    colors: ["#2ea8e5", "#5fb236", "#a28ae5"],
  },
];

let installed = false;

export function installColorSchemes() {
  if (installed) return;
  const reader = Zotero.Reader as any;
  if (typeof reader?.registerEventListener !== "function") {
    ztoolkit.log("[reader] registerEventListener unavailable");
    return;
  }
  installed = true;

  const flat = (event: any) => {
    try {
      if (!getPref("reader.schemes")) return;
      const { reader: instance, append } = event;
      if (typeof append !== "function") return;
      append(
        ...SCHEMES.map((scheme) => ({
          label: getString(scheme.labelID),
          color: scheme.colors[0],
          disabled: false,
          // rows without `persistent` are dropped by the internal menu builder
          persistent: true,
          onCommand: () => applyScheme(instance, scheme),
        })),
      );
    } catch (e) {
      ztoolkit.log("[reader] colour menu failed", e);
    }
  };

  for (const type of [
    "createColorContextMenu",
    "createAnnotationContextMenu",
  ]) {
    try {
      reader.registerEventListener(type, flat, config.addonID);
    } catch (e) {
      ztoolkit.log(`[reader] cannot hook ${type}`, e);
    }
  }

  // the page context menu is native XUL, so it can carry a real submenu
  try {
    reader.registerEventListener(
      "createViewContextMenu",
      (event: any) => {
        try {
          if (!getPref("reader.schemes")) return;
          const { reader: instance, append } = event;
          if (typeof append !== "function") return;
          append({
            label: getString("reader-scheme-menu"),
            groups: [
              SCHEMES.map((scheme) => ({
                label: getString(scheme.labelID),
                color: scheme.colors[0],
                disabled: false,
                onCommand: () => applyScheme(instance, scheme),
              })),
            ],
          });
        } catch (e) {
          ztoolkit.log("[reader] view menu failed", e);
        }
      },
      config.addonID,
    );
  } catch (e) {
    ztoolkit.log("[reader] cannot hook createViewContextMenu", e);
  }
}

/** set the current highlight tool to the scheme's first colour */
function applyScheme(reader: any, scheme: ColorScheme) {
  try {
    const internal = reader?._internalReader;
    if (typeof internal?.setTool !== "function") return;
    internal.setTool({ type: "highlight", color: scheme.colors[0] });
  } catch (e) {
    ztoolkit.log("[reader] setTool failed", e);
  }
}
