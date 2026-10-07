import { httpErrorToHuman } from '@pterodactyl/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listDirectory, type TreeEntry } from './api';
import { dirname } from './paths';

export type Listing = { items: TreeEntry[] } | { error: string } | 'loading';

const REFRESH_MS = 20_000;

export interface TreeState {
    listings: Record<string, Listing>;
    expanded: ReadonlySet<string>;
    toggle: (path: string) => void;
    expand: (path: string) => void;
    /** Fetch directories again; unknown or collapsed ones are skipped unless `force` is set. */
    reload: (directories: readonly string[], force?: boolean) => Promise<void>;
    /** Change a listing at once (before the server confirms), so the explorer never waits for a round trip. */
    patch: (directory: string, change: (items: TreeEntry[]) => TreeEntry[]) => void;
}

/**
 * The explorer's data: every directory that has been opened, kept up to date. Mutations patch the listing
 * immediately and then reload it; visible directories also reload when the tab regains focus and now and then.
 */
export function useTree(uuid: string): TreeState {
    const [listings, setListings] = useState<Record<string, Listing>>({});
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
                const items = await listDirectory(uuid, directory);
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

    useEffect(() => {
        setListings({});
        setExpanded(new Set(['/']));
        void load('/');
    }, [uuid, load]);

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

    return { listings, expanded, toggle, expand, reload, patch };
}

/** The directories whose listing changes when `paths` are created, renamed, moved or deleted. */
export const parentsOf = (paths: readonly string[]): string[] => [...new Set(paths.map(dirname))];
