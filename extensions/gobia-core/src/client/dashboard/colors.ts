/** Icon colour helpers. */

const HEX = /^#[0-9a-f]{6}$/;

/** Lower cases and validates a `#rrggbb` colour, returning null for anything else. */
export function normaliseHex(value: string): string | null {
    const lower = value.trim().toLowerCase();
    return HEX.test(lower) ? lower : null;
}
