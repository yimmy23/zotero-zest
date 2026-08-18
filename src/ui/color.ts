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

/**
 * Text colour derived from a badge colour that stays readable on the badge's
 * translucent background: same hue, lightness clamped to ≤ 40 % on light
 * themes and ≥ 70 % on dark themes (the original plugin's "auto" rule,
 * extended for dark mode).
 */
export function readableTextColor(
  rgb: [number, number, number],
  dark: boolean,
): string {
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const l = dark ? 0.72 : 0.36;
  const sat = Math.max(0.35, s);
  return `hsl(${Math.round(h * 360)}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`;
}
