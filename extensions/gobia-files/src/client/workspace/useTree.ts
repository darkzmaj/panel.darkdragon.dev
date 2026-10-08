import { httpErrorToHuman } from '@pterodactyl/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listDirectory, type TreeEntry } from './api';
import { dirname } from './paths';
import { mark } from './timing';

export type Listing = { items: TreeEntry[] } | { error: string } | 'loading';
export type Listings = Record<string, Listing>;

const REFRESH_MS = 20_000;

/**
 * Where the root listing comes from: 'wait' while the Panel is still listing it (the explorer must not ask for it a
 * second time), 'fetch' to ask the server, or the entries the Panel already holds.
 */
export type TreeSource = 'wait' | 'fetch' | readonly TreeEntry[];

export interface TreeState {
    listings: Listings;
    expanded: ReadonlySet<string>;
    toggle: (path: string) => void;
    expand: (path: string) => void;
    /** Fetch directories again; unknown or collapsed ones are skipped unless `force` is set. */
    reload: (directories: readonly string[], force?: boolean) => Promise<void>;
    /** Change a listing at once (before the server confirms), so the explorer never waits for a round trip. */
    patch: (directory: string, change: (items: TreeEntry[]) => TreeEntry[]) => void;
    /**
     * Move an entry in the local state at once (listings, expanded folders and the subtree of a moved folder follow it).
     * Returns a function that puts everything back, for when the server refuses.
     */
    move: (from: string, to: string) => () => void;
    /** Remove entries locally at once; returns the undo. */
    remove: (paths: readonly string[]) => () => void;
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const reroot = (path: string, from: string, to: string) =>
    under(path, from) ? `${to}${path.slice(from.length)}` : path;
const order = (a: TreeEntry, b: TreeEntry) =>
    a.directory === b.directory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.directory ? -1 : 1;

const isLoaded = (listing: Listing | undefined): listing is { items: TreeEntry[] } =>
    listing !== undefined && listing !== 'loading' && 'items' in listing;

/**
 * The listings after `from` moved to `to`: a moved folder keeps every listing it had under its new path, the old
 * parent loses the entry and the new parent gains it (when those directories are loaded), in listing order.
 */
export function moveListings(current: Listings, from: string, to: string): Listings {
    const source = dirname(from);
    const target = dirname(to);
    const found = isLoaded(current[source]) ? current[source].items.find((item) => item.path === from) : undefined;
    const next: Listings = {};
    for (const [directory, listing] of Object.entries(current)) {
        const key = reroot(directory, from, to);
        next[key] =
            isLoaded(listing) && key !== directory
                ? { items: listing.items.map((item) => ({ ...item, path: reroot(item.path, from, to) })) }
                : listing;
    }
    const sourceListing = next[source];
    if (isLoaded(sourceListing)) next[source] = { items: sourceListing.items.filter((item) => item.path !== from) };
    const targetListing = next[target];
    if (found && isLoaded(targetListing)) {
        const moved: TreeEntry = { ...found, name: to.slice(to.lastIndexOf('/') + 1), path: to };
        next[target] = { items: [...targetListing.items.filter((item) => item.path !== to), moved].sort(order) };
    }
    return next;
}

/** The listings without `paths`: entries are removed, and so are the listings of removed folders. */
export function removeFromListings(current: Listings, paths: readonly string[]): Listings {
    const next: Listings = {};
    for (const [directory, listing] of Object.entries(current)) {
        if (paths.some((path) => under(directory, path))) continue;
        next[directory] = isLoaded(listing)
            ? { items: listing.items.filter((item) => !paths.includes(item.path)) }
            : listing;
    }
    return next;
}

/**
 * The explorer's data: every directory that has been opened, kept up to date. Mutations patch the listing
 * immediately and then reload it; visible directories also reload when the tab regains focus and now and then.
 */
export function useTree(uuid: string, source: TreeSource = 'fetch'): TreeState {
    const [listings, setListings] = useState<Listings>({});
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['/']));
    const latest = useRef({ listings, expanded });
    useEffect(() => {
        latest.current = { listings, expanded };
    });

    const load = useCallback(
        async (directory: string) => {
            setListings((current) => {
                const existing = current[directory];
                return existing && existing !== 'loading' && 'items' in existing
                    ? current
                    : { ...current, [directory]: 'loading' };
            });
            try {
                if (directory === '/') mark('tree-request', true);
                const items = await listDirectory(uuid, directory);
                if (directory === '/') mark('tree-response', true);
                setListings((current) => ({ ...current, [directory]: { items } }));
            } catch (error) {
                setListings((current) => ({ ...current, [directory]: { error: httpErrorToHuman(error as Error) } }));
            }
        },
        [uuid]
    );

    const reload = useCallback(
        async (directories: readonly string[], force = false) => {
            const wanted = [...new Set(directories)].filter(
                (directory) => force || latest.current.expanded.has(directory) || directory in latest.current.listings
            );
            await Promise.all(wanted.map((directory) => load(directory)));
        },
        [load]
    );

    const expand = useCallback(
        (path: string) => {
            setExpanded((current) => (current.has(path) ? current : new Set(current).add(path)));
            if (!(path in latest.current.listings)) void load(path);
        },
        [load]
    );

    const toggle = useCallback(
        (path: string) => {
            if (latest.current.expanded.has(path)) {
                setExpanded((current) => {
                    const next = new Set(current);
                    next.delete(path);
                    return next;
                });
            } else {
                expand(path);
            }
        },
        [expand]
    );

    const patch = useCallback((directory: string, change: (items: TreeEntry[]) => TreeEntry[]) => {
        setListings((current) => {
            const listing = current[directory];
            if (!listing || listing === 'loading' || 'error' in listing) return current;
            return { ...current, [directory]: { items: change(listing.items) } };
        });
    }, []);

    const move = useCallback((from: string, to: string) => {
        const before = { listings: latest.current.listings, expanded: latest.current.expanded };
        setListings((current) => moveListings(current, from, to));
        setExpanded((current) => new Set([...current].map((path) => reroot(path, from, to))));
        return () => {
            setListings(before.listings);
            setExpanded(before.expanded);
        };
    }, []);

    const remove = useCallback((paths: readonly string[]) => {
        const before = latest.current.listings;
        setListings((current) => removeFromListings(current, paths));
        return () => setListings(before);
    }, []);

    const mode = source === 'wait' ? 'wait' : source === 'fetch' ? 'fetch' : 'seed';
    const initial = useRef(source);
    initial.current = source;
    useEffect(() => {
        if (mode === 'wait') return;
        setExpanded(new Set(['/']));
        const entries = initial.current;
        if (mode === 'seed' && Array.isArray(entries)) {
            setListings({ '/': { items: [...entries].sort(order) } });
        } else {
            setListings({});
            void load('/');
        }
    }, [uuid, mode, load]);

    useEffect(() => {
        const visible = () => [...latest.current.expanded];
        const refresh = () => {
            if (!document.hidden) void reload(visible());
        };
        const timer = window.setInterval(refresh, REFRESH_MS);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [reload]);

    return { listings, expanded, toggle, expand, reload, patch, move, remove };
}

/** The directories whose listing changes when `paths` are created, renamed, moved or deleted. */
export const parentsOf = (paths: readonly string[]): string[] => [...new Set(paths.map(dirname))];
