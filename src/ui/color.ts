/** Small colour helpers (no dependencies). */

export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

/** Theme-aware decorative border colour; preserve neutral hues. */
export function readableTextColor(
  rgb: [number, number, number],
  dark: boolean,
): string {
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const l = dark ? 0.72 : 0.36;
  const sat = s;
  return `hsl(${Math.round(h * 360)}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`;
}

/** Keep both contrasts available so CSS can follow theme changes without a render. */
export function setReadableColorVariants(
  element: HTMLElement,
  rgb: [number, number, number],
): void {
  element.style.setProperty(
    "--zest-readable-light",
    readableTextColor(rgb, false),
  );
  element.style.setProperty(
    "--zest-readable-dark",
    readableTextColor(rgb, true),
  );
}

/** Tint the native surface while keeping native text legible in both themes. */
export function setSemanticBadge(
  element: HTMLElement,
  rgb: [number, number, number],
  opacity = 0.16,
): void {
  element.classList.add("zest-readable-text");
  element.style.setProperty("--zest-badge-rgb", rgb.join(","));
  element.style.setProperty(
    "--zest-badge-opacity",
    // Strong fills can erase native text contrast, especially on dark surfaces.
    // Custom text colours bypass this helper and retain the exact preference.
    String(
      Number.isFinite(opacity) ? Math.min(0.25, Math.max(0, opacity)) : 0.16,
    ),
  );
}
