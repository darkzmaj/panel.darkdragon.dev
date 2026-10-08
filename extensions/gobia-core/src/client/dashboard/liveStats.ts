import { http } from '@pterodactyl/sdk';
import { useSyncExternalStore } from 'react';

/** The latest numbers Wings pushed for one instance. Bytes for memory and disk, percent of one core for the CPU. */
export interface Live {
    state: string | null;
    cpu: number | null;
    memory: number | null;
    disk: number | null;
}

interface Entry {
    uuid: string;
    refs: number;
    live: Live | null;
    listeners: Set<() => void>;
    socket: WebSocket | null;
    attempts: number;
    timer: number | undefined;
    release: number | undefined;
    stopped: boolean;
}

/** Browsers cope with many sockets, Wings nodes less so: rows beyond this keep using the polled numbers. */
const MAX_SOCKETS = 24;
const GRACE_MS = 4000;
const entries = new Map<string, Entry>();

// The credentials route is limited to five requests a minute per instance, and the instance's own page asks for them
// too. A token is good for fifteen minutes, so the list keeps one for ten and reuses it when a row comes back.
const TOKEN_MS = 10 * 60 * 1000;
const credentialCache = new Map<string, { at: number; token: string; socket: string }>();

const emit = (entry: Entry) => {
    for (const listener of [...entry.listeners]) listener();
};

const connected = () => [...entries.values()].filter((entry) => entry.socket !== null).length;

async function connect(entry: Entry): Promise<void> {
    if (entry.stopped || entry.socket) return;
    if (connected() >= MAX_SOCKETS) return;
    let credentials: { token: string; socket: string };
    const cached = credentialCache.get(entry.uuid);
    try {
        if (cached && Date.now() - cached.at < TOKEN_MS) {
            credentials = cached;
        } else {
            credentials = (
                await http.get<{ data: { token: string; socket: string } }>(
                    `/api/client/servers/${entry.uuid}/websocket`
                )
            ).data.data;
            credentialCache.set(entry.uuid, { at: Date.now(), ...credentials });
        }
    } catch (error) {
        // The credentials route is limited per instance: wait a full minute after a refusal.
        const limited = (error as { response?: { status?: number } }).response?.status === 429;
        schedule(entry, limited ? 60_000 : undefined);
        return;
    }
    if (entry.stopped) return;
    const socket = new WebSocket(credentials.socket);
    entry.socket = socket;
    const send = (event: string, args: unknown[]) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, args }));
    };
    const refresh = () => {
        http.get<{ data: { token: string } }>(`/api/client/servers/${entry.uuid}/websocket`)
            .then((response) => send('auth', [response.data.data.token]))
            .catch(() => socket.close());
    };
    socket.onopen = () => send('auth', [credentials.token]);
    socket.onmessage = (message) => {
        let frame: { event?: string; args?: unknown[] };
        try {
            frame = JSON.parse(String(message.data));
        } catch {
            return;
        }
        const first = frame.args?.[0];
        switch (frame.event) {
            case 'auth success':
                entry.attempts = 0;
                send('send stats', [null]);
                break;
            case 'stats': {
                try {
                    const stats = JSON.parse(String(first)) as {
                        state?: string;
                        cpu_absolute?: number;
                        memory_bytes?: number;
                        disk_bytes?: number;
                    };
                    entry.live = {
                        state: stats.state ?? entry.live?.state ?? null,
                        cpu: stats.cpu_absolute ?? null,
                        memory: stats.memory_bytes ?? null,
                        disk: stats.disk_bytes ?? null,
                    };
                    emit(entry);
                } catch {
                    // A malformed frame is ignored; the next one repairs the picture.
                }
                break;
            }
            case 'status':
                entry.live = {
                    state: String(first),
                    cpu: entry.live?.cpu ?? null,
                    memory: entry.live?.memory ?? null,
                    disk: entry.live?.disk ?? null,
                };
                emit(entry);
                break;
            case 'token expiring':
            case 'token expired':
                refresh();
                break;
            case 'jwt error':
                credentialCache.delete(entry.uuid);
                socket.close();
                break;
        }
    };
    socket.onclose = () => {
        if (entry.socket === socket) entry.socket = null;
        if (!entry.stopped) schedule(entry);
    };
    socket.onerror = () => socket.close();
}

function schedule(entry: Entry, delay?: number) {
    if (entry.stopped || entry.timer !== undefined) return;
    entry.attempts += 1;
    const wait = delay ?? Math.min(30_000, 1500 * 2 ** Math.min(entry.attempts, 5)) * (0.5 + Math.random() / 2);
    entry.timer = window.setTimeout(() => {
        entry.timer = undefined;
        void connect(entry);
    }, wait);
}

function subscribe(uuid: string, listener: () => void): () => void {
    let entry = entries.get(uuid);
    if (!entry) {
        entry = {
            uuid,
            refs: 0,
            live: null,
            listeners: new Set(),
            socket: null,
            attempts: 0,
            timer: undefined,
            release: undefined,
            stopped: false,
        };
        entries.set(uuid, entry);
    }
    const current = entry;
    window.clearTimeout(current.release);
    current.release = undefined;
    current.stopped = false;
    current.refs += 1;
    current.listeners.add(listener);
    void connect(current);

    return () => {
        current.listeners.delete(listener);
        current.refs -= 1;
        if (current.refs > 0) return;
        // Scrolling a row away and back must not reconnect: close only after a grace period without subscribers.
        current.release = window.setTimeout(() => {
            current.stopped = true;
            window.clearTimeout(current.timer);
            current.timer = undefined;
            current.socket?.close();
            current.socket = null;
            entries.delete(uuid);
        }, GRACE_MS);
    };
}

const noSubscription = () => () => undefined;

/** Live numbers of one instance, pushed by Wings over a websocket; null until the first frame (or without one). */
export function useLiveStats(uuid: string | null): Live | null {
    return useSyncExternalStore(
        uuid ? (listener) => subscribe(uuid, listener) : noSubscription,
        () => (uuid ? (entries.get(uuid)?.live ?? null) : null),
        () => null
    );
}
