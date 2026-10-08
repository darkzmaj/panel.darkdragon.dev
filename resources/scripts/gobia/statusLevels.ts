/** How loaded one resource is: grey while it is not measured, green normal, yellow high, red at or over the limit. */
export type Level = 'idle' | 'ok' | 'high' | 'max';

/** At or above this share of its limit a resource is high (the dot flashes yellow). */
export const HIGH_AT = 0.75;
/** At or above this share it is at its limit (the dot flashes red). */
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

/** What the instance is doing, which decides how all four dots look. */
export type DotsMode = 'running' | 'transition' | 'offline' | 'unavailable' | 'installing' | 'checking';

/**
 * `state` is the power state Wings reports (null while unknown), `status` the instance's own status from the Panel
 * (null when it is usable; installing, suspended or a failed install otherwise).
 */
export function modeOf(state: string | null, status: string | null): DotsMode {
    if (status === 'installing') return 'installing';
    if (status !== null) return 'unavailable';
    switch (state) {
        case 'running':
            return 'running';
        case 'starting':
        case 'stopping':
            return 'transition';
        case 'offline':
        case 'stopped':
            return 'offline';
        default:
            return 'checking';
    }
}

export interface DotView {
    level: Level;
    flashing: boolean;
}

/**
 * One dot. Everything that is alive flashes: running dots in the colour of their level, starting, stopping and
 * installing in yellow, an unknown state in grey. The only dots that hold still are the red ones of an instance that is
 * off or unavailable. `own` is the level of this dot's resource (green for the power dot).
 */
export function dotView(mode: DotsMode, own: Level): DotView {
    switch (mode) {
        case 'offline':
        case 'unavailable':
            return { level: 'max', flashing: false };
        case 'transition':
        case 'installing':
            return { level: 'high', flashing: true };
        case 'checking':
            return { level: 'idle', flashing: true };
        case 'running':
            return { level: own === 'idle' ? 'ok' : own, flashing: true };
    }
}

export const LEVEL_TEXT = {
    idle: 'not measured',
    ok: 'normal',
    high: 'high',
    max: 'at its limit',
} satisfies Record<Level, string>;
