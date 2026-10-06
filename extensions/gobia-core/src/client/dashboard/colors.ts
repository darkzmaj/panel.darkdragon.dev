/** Icon colour helpers: presets, hex validation and a readable foreground for any background. */

export const PRESETS = [
    '#4da3ff',
    '#1264d1',
    '#22c55e',
    '#16a34a',
    '#eab308',
    '#f97316',
    '#ef4444',
    '#ec4899',
    '#a855f7',
    '#14b8a6',
    '#64748b',
    '#0f172a',
] as const;

const HEX = /^#[0-9a-f]{6}$/;

/** Lower cases and validates a `#rrggbb` colour, returning null for anything else. */
export function normaliseHex(value: string): string | null {
    const lower = value.trim().toLowerCase();
    return HEX.test(lower) ? lower : null;
}

/** Relative luminance per WCAG, from 0 (black) to 1 (white). */
export function luminance(hex: string): number {
    const channel = (offset: number) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Black or white, whichever reads better on the given background. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
    return luminance(hex) > 0.179 ? '#000000' : '#ffffff';
}
