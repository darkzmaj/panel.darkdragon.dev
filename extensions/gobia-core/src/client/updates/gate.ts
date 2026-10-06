import type { Preflight, UpdateCheck, UpdateState } from './types';

export const TERMINAL: readonly UpdateState[] = ['completed', 'failed', 'rolled_back'];

export type GateReason = 'no-updater' | 'up-to-date' | 'not-ready' | 'ready';

/**
 * The Update button rule. A newer Pterodactyl release is irrelevant: an update is allowed only when the updater reports
 * an approved Gobia release AND the local preflight says this installation is ready. Anything missing keeps it closed.
 */
export function updateGate(check: UpdateCheck | null | undefined, preflight: Preflight | null | undefined): GateReason {
    if (!check) return 'no-updater';
    if (!check.update_available || !check.latest_approved) return 'up-to-date';
    if (!preflight || !preflight.ready) return 'not-ready';
    if (preflight.checks.some((item) => item.required && item.status !== 'pass')) return 'not-ready';
    return 'ready';
}

export function failingChecks(preflight: Preflight | null | undefined) {
    return (preflight?.checks ?? []).filter(
        (item) => item.status === 'fail' || (item.required && item.status !== 'pass')
    );
}

export function isTerminal(state: UpdateState): boolean {
    return TERMINAL.includes(state);
}
