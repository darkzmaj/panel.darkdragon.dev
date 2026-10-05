import getServerResourceUsage, { ServerStats } from '@/api/server/getServerResourceUsage';

// One shared scheduler for the live numbers of every row on the dashboard. Rows subscribe while they are on screen;
// the hub fetches them a few at a time, at most once per interval, and not at all while the tab is hidden. This
// replaces one timer and one burst of requests per row, which scaled badly with long instance lists.

type Listener = (stats: ServerStats | null) => void;

const INTERVAL = 30000;
const CONCURRENCY = 4;

const listeners = new Map<string, Set<Listener>>();
const latest = new Map<string, { stats: ServerStats; at: number }>();
const queued = new Set<string>();
let running = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const pump = () => {
    while (running < CONCURRENCY && queued.size) {
        const uuid = queued.values().next().value as string;
        queued.delete(uuid);
        if (!listeners.has(uuid)) continue;
        running++;
        getServerResourceUsage(uuid)
            .then((stats) => {
                latest.set(uuid, { stats, at: Date.now() });
                listeners.get(uuid)?.forEach((l) => l(stats));
            })
            .catch((error) => {
                // 409: the server is installing or transferring and has no live numbers yet. Not an error.
                if (error?.response?.status !== 409) console.error(error);
            })
            .then(() => {
                running--;
                pump();
            });
    }
};

const tick = () => {
    if (document.hidden) return;
    listeners.forEach((_, uuid) => queued.add(uuid));
    pump();
};

export const subscribeStats = (uuid: string, listener: Listener): (() => void) => {
    if (!listeners.has(uuid)) listeners.set(uuid, new Set());
    listeners.get(uuid)!.add(listener);

    const known = latest.get(uuid);
    if (known && Date.now() - known.at < INTERVAL) {
        listener(known.stats);
    } else {
        queued.add(uuid);
        pump();
    }
    if (!timer) timer = setInterval(tick, INTERVAL);

    return () => {
        const set = listeners.get(uuid);
        set?.delete(listener);
        if (set && !set.size) listeners.delete(uuid);
        if (!listeners.size && timer) {
            clearInterval(timer);
            timer = null;
        }
    };
};
