/** How loaded one resource is: grey while it is not measured, green normal, yellow high, red at or over the limit. */
export type Level = 'idle' | 'ok' | 'high' | 'max';

/** At or above this share of its limit a resource is high (the dot flashes yellow). */
export const HIGH_AT = 0.75;
/** At or above this share it is at its limit (the dot turns red). */
export const MAX_AT = 0.95;

/**
 * The level of a resource. `limit` of 0 means unlimited: it is normal whenever it is measured. `value` null means
 * there is nothing to measure (the instance is off or the number has not arrived).
 */
export function levelOf(value: number | null, limit: number): Level {
    if (value === null || !Number.isFinite(value)) return 'idle';
    if (limit <= 0) return 'ok';
    const share = value / limit;
    if (share >= MAX_AT) return 'max';
    if (share >= HIGH_AT) return 'high';
    return 'ok';
}

/** The power dot: running flashes green, starting and stopping flash yellow, anything unavailable is red, off is grey. */
export interface PowerView {
    level: Level;
    flashing: boolean;
}

export function powerLevel(state: string | null, problem = false): PowerView {
    if (problem) return { level: 'max', flashing: false };
    switch (state) {
        case 'running':
            return { level: 'ok', flashing: true };
        case 'starting':
        case 'stopping':
            return { level: 'high', flashing: true };
        default:
            return { level: 'idle', flashing: false };
    }
}

export const LEVEL_TEXT = {
    idle: 'not measured',
    ok: 'normal',
    high: 'high',
    max: 'at its limit',
} satisfies Record<Level, string>;
