/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa` into 0-1 channels; `null` for anything else or `transparent`. */
export function parseHexColor(color: string | undefined): { r: number; g: number; b: number; a: number } | null {
  if (!color) return null;
  let hex = color.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) : 1 };
}
