import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    useAccountServerSearch,
    serverResourceUsageQueryOptions,
    type AccountServer,
} from '@/api/account/servers/queries';
import { queryClient } from '@/api/queryClient';
import { selectServerPermissions, serverQueryOptions } from '@/api/server/queries';
import { hasPermission } from '@/plugins/usePermissions';
import { getAreaNav } from '@/router/nav';

const POWER_LOOKUPS = 8;

function Item({
    server,
    active,
    withPower,
    onPick,
    id,
}: {
    server: AccountServer;
    active: boolean;
    withPower: boolean;
    onPick: () => void;
    id: string;
}) {
    const power = useQuery({
        ...serverResourceUsageQueryOptions(server.attributes.uuid),
        enabled: withPower,
        staleTime: 10_000,
    });
    const state = power.data?.attributes.current_state ?? null;
    const note = server.attributes.is_suspended
        ? 'Suspended'
        : server.attributes.status === 'installing'
          ? 'Installing'
          : state === 'running'
            ? 'Online'
            : state
              ? 'Offline'
              : '';

    return (
        <li
            id={id}
            role={'option'}
            aria-selected={active}
            className={'gb-picker-item' + (active ? ' active' : '')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPick}
        >
            <span className={'gb-sdot ' + (state === 'running' ? 'ok' : 'idle')} aria-hidden />
            <span className={'gb-picker-text'}>
                <strong>{server.attributes.name}</strong>
                <small>
                    {server.attributes.node}
                    {server.attributes.description ? ` · ${server.attributes.description}` : ''}
                </small>
            </span>
            <span className={'gb-picker-state'}>{note}</span>
        </li>
    );
}

/**
 * Wraps the instance card of the sidebar. Clicking it opens a searchable list of every instance the person can open;
 * choosing one keeps the page: Files stays Files, Backups stays Backups. Where the new instance does not let the
 * person see that page, the first page they may see opens instead.
 */
export default function ServerSwitcher({ id, children }: { id: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const popover = useRef<HTMLDivElement>(null);
    const listId = useId();
    const navigate = useNavigate();
    const location = useLocation();
    const { data } = useAccountServerSearch({ query: search }, open);
    const items = data?.data ?? [];

    useLayoutEffect(() => {
        if (!open || !trigger.current) return;
        const rect = trigger.current.getBoundingClientRect();
        const width = Math.max(rect.width, 300);
        setBox({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: rect.bottom + 6, width });
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const away = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!popover.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
        };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);
    useEffect(() => setHighlight(0), [search, open]);

    const choose = async (server: AccountServer) => {
        const target = server.attributes.identifier;
        setOpen(false);
        setSearch('');
        if (target === id) return;
        // The page to keep: the first segment after /server/<id>.
        const rest = location.pathname.replace(new RegExp(`^/server/${id}/?`), '');
        const segment = rest.split('/')[0] ?? '';
        let allowed: string | null = segment;
        try {
            const loaded = await queryClient.ensureQueryData(serverQueryOptions(target));
            const permissions = selectServerPermissions(loaded);
            const mayOpen = (name: string) => {
                const entry = getAreaNav('server').find((candidate) => candidate.segment === name);
                if (!entry) return name === '';
                if (!entry.permission) return true;
                return (Array.isArray(entry.permission) ? entry.permission : [entry.permission]).some((permission) =>
                    hasPermission(permissions, permission)
                );
            };
            if (!mayOpen(segment))
                allowed = getAreaNav('server').find((entry) => mayOpen(entry.segment))?.segment ?? '';
        } catch {
            allowed = segment;
        }
        void navigate({ to: `/server/${target}${allowed ? `/${allowed}` : ''}` as never });
    };

    return (
        <>
            <button
                ref={trigger}
                type={'button'}
                className={'gb-subcard gb-switcher'}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                aria-label={'Switch instance'}
                onClick={() => setOpen((value) => !value)}
            >
                {children}
                <ChevronsUpDown className={'gb-switcher-chevron'} aria-hidden />
            </button>
            {open &&
                box &&
                createPortal(
                    <div
                        ref={popover}
                        className={'gb-picker-pop'}
                        style={{ left: box.left, top: box.top, width: box.width }}
                        role={'dialog'}
                        aria-label={'Switch instance'}
                    >
                        <label className={'gb-picker-search'}>
                            <Search aria-hidden />
                            <input
                                autoFocus
                                value={search}
                                placeholder={'Search instances'}
                                aria-label={'Search instances'}
                                role={'combobox'}
                                aria-expanded
                                aria-controls={listId}
                                aria-activedescendant={items[highlight] ? `${listId}-${highlight}` : undefined}
                                onChange={(event) => setSearch(event.currentTarget.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'ArrowDown') {
                                        event.preventDefault();
                                        setHighlight((index) => Math.min(items.length - 1, index + 1));
                                    } else if (event.key === 'ArrowUp') {
                                        event.preventDefault();
                                        setHighlight((index) => Math.max(0, index - 1));
                                    } else if (event.key === 'Enter') {
                                        event.preventDefault();
                                        const picked = items[highlight];
                                        if (picked) void choose(picked);
                                    } else if (event.key === 'Escape') {
                                        setOpen(false);
                                        trigger.current?.focus();
                                    }
                                }}
                            />
                        </label>
                        <ul id={listId} role={'listbox'} aria-label={'Instances'} className={'gb-picker-list'}>
                            {items.map((server, index) => (
                                <Item
                                    key={server.attributes.uuid}
                                    id={`${listId}-${index}`}
                                    server={server}
                                    active={index === highlight}
                                    withPower={index < POWER_LOOKUPS}
                                    onPick={() => void choose(server)}
                                />
                            ))}
                            {data && items.length === 0 && <li className={'gb-picker-empty'}>No instance matches.</li>}
                            {!data && <li className={'gb-picker-empty'}>Loading instances…</li>}
                        </ul>
                    </div>,
                    document.body
                )}
        </>
    );
}
