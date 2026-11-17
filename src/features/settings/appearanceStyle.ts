import { defaultDialogTransparency } from '../../../shared/appearance.ts';
import type { Appearance } from '../../../shared/appearance.ts';

export const fonts = {
  system: { label: '系统默认', stack: '"Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif' },
  sans: { label: '简洁字体', stack: 'Inter, DengXian, "Microsoft YaHei UI", Arial, sans-serif' },
  serif: { label: '书本字体', stack: 'Georgia, "Songti SC", SimSun, serif' },
  mono: { label: '等宽字体', stack: '"Cascadia Mono", Consolas, SimHei, "Microsoft YaHei UI", monospace' },
} satisfies Record<Appearance['fontFamily'], { label: string; stack: string }>;

function channels(color: string) {
  return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
}

function luminance(color: string) {
  const [r, g, b] = channels(color).map((value) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function contrast(a: string, b: string) {
  const x = luminance(a) + 0.05;
  const y = luminance(b) + 0.05;
  return Math.max(x / y, y / x);
}

function mix(a: string, b: string, amount: number) {
  const end = channels(b);
  return '#' + channels(a).map((start, index) => Math.round(start + (end[index] - start) * amount)
    .toString(16).padStart(2, '0')).join('');
}

function readableTone(color: string, backgrounds: string[], fallback: string) {
  for (let step = 0; step < 20; step++) {
    const candidate = mix(color, fallback, step / 20);
    if (backgrounds.every((background) => contrast(candidate, background) >= 4.5)) return candidate;
  }
  return fallback;
}

function glassPalette(color: string, lightText: boolean, transparency: number) {
  const foreground = lightText ? '#ffffff' : '#000000';
  const solid = lightText ? '#000000' : '#ffffff';
  const scrimColor = lightText ? '#07090d' : '#161c18';
  const scrimOpacity = lightText ? 0.34 : 0.18;
  const scrim = 'rgb(' + channels(scrimColor).join(' ') + ' / ' + scrimOpacity + ')';
  const extremeBackdrop = mix(foreground, scrimColor, scrimOpacity);
  const lightestOrDarkest = (base: string) => {
    const overBackdrop = mix(base, extremeBackdrop, transparency / 100);
    // Include the brightest part of the pane's white sheen in the dark theme.
    return lightText ? mix(overBackdrop, foreground, 0.07) : overBackdrop;
  };
  for (let step = 0; step <= 20; step++) {
    const base = mix(color, solid, step / 20);
    const extreme = lightestOrDarkest(base);
    if (contrast(foreground, extreme) >= 4.75) return { base, extreme, scrim };
  }
  return { base: solid, extreme: lightestOrDarkest(solid), scrim };
}

export function appearanceVariables(appearance: Appearance) {
  const { background, accent, fontFamily, fontSize, dialogTransparency, dialogTint } = appearance;
  const dark = contrast('#ffffff', background) >= contrast('#000000', background);
  const fallback = dark ? '#ffffff' : '#000000';
  const surface = dark ? mix('#292929', background, 0.66) : '#ffffff';
  const sidebar = dark ? mix('#252525', background, 0.76) : mix('#f0f1eb', background, 0.14);
  const input = dark ? mix(surface, fallback, 0.045) : '#fafbf8';
  const tinted = mix(sidebar, accent, 0.11);
  const selection = contrast(fallback, tinted) >= 4.5 ? tinted : sidebar;
  const backgrounds = [background, surface, sidebar, input, selection];
  const text = readableTone(dark ? '#f1f3ee' : '#292d28', backgrounds, fallback);
  const muted = readableTone(dark ? '#b2bcaf' : '#62695e', backgrounds, fallback);
  const highlight = readableTone(accent, backgrounds, fallback);
  const danger = readableTone(dark ? '#f3a39c' : '#a23832', backgrounds, fallback);
  const transparency = dialogTransparency ?? defaultDialogTransparency;
  const glassOpacity = (100 - transparency) + '%';
  const glassFilter = transparency ? 'blur(18px) saturate(138%)' : 'none';
  const glass = glassPalette(dialogTint ?? mix(surface, background, 0.24), dark, transparency);
  const glassBackgrounds = [...backgrounds, glass.base, glass.extreme];
  const primary = dark ? highlight : mix(highlight, '#000000', 0.06);
  const primaryText = contrast('#ffffff', primary) >= contrast('#000000', primary) ? '#ffffff' : '#000000';
  return {
    '--canvas': background, '--surface': surface, '--sidebar': sidebar, '--input': input,
    '--text': text, '--muted': muted, '--accent': highlight,
    '--accent-soft': selection, '--primary': primary, '--primary-text': primaryText,
    '--border': mix(surface, text, 0.14), '--control-border': mix(surface, text, 0.32),
    '--danger': danger,
    '--glass-base': glass.base,
    '--glass-opacity': glassOpacity,
    '--glass-filter': glassFilter,
    '--glass-opacity-reduced': dialogTransparency === null ? '100%' : glassOpacity,
    '--glass-filter-reduced': dialogTransparency === null ? 'none' : glassFilter,
    '--glass-scrim': glass.scrim,
    '--glass-text': readableTone(text, glassBackgrounds, fallback),
    '--glass-muted': readableTone(muted, glassBackgrounds, fallback),
    '--glass-accent': readableTone(highlight, glassBackgrounds, fallback),
    '--glass-danger': readableTone(danger, glassBackgrounds, fallback),
    '--font-ui': fonts[fontFamily].stack, '--font-size': fontSize + 'px',
    '--scheme': dark ? 'dark' : 'light',
  };
}
