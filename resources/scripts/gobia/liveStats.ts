import { useSyncExternalStore } from 'react';

/** The newest numbers the server websocket pushed, shared by everything in the server area (the sidebar card, the console). */
export interface LiveStats {
    cpu: number;
    memory: number;
    disk: number;
}

let current: LiveStats | null = null;
let owner: string | null = null;
const listeners = new Set<() => void>();

export function pushLiveStats(uuid: string, stats: LiveStats | null) {
    owner = uuid;
    current = stats;
    for (const listener of [...listeners]) listener();
}

/** Forget the numbers of a server the page has left, so they never show under the next one. */
export function resetLiveStats() {
    owner = null;
    current = null;
    for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** The live numbers of `uuid`, or null while none arrived (or they belong to another server). */
export const useLiveStats = (uuid: string): LiveStats | null =>
    useSyncExternalStore(
        subscribe,
        () => (owner === uuid ? current : null),
        () => null
    );
