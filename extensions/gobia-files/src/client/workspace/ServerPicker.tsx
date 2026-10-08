import { ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePowerState, useServers, type PickableServer } from './servers';

interface Props {
    /** The server shown now. */
    current: { uuid: string; name: string; node: string } | null;
    onPick: (server: PickableServer) => void;
    label: string;
}

const powerText = (state: string | null | undefined) => (state === 'running' ? 'Online' : state ? 'Offline' : '');

function Item({
    server,
    active,
    withPower,
    onPick,
    id,
}: {
    server: PickableServer;
    active: boolean;
    withPower: boolean;
    onPick: () => void;
    id: string;
}) {
    const power = usePowerState(server.uuid, withPower);
    const state = power.data ?? null;

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
                <strong>{server.name}</strong>
                <small>
                    {server.node}
                    {server.description ? ` · ${server.description}` : ''}
                </small>
            </span>
            <span className={'gb-picker-state'}>
                {server.suspended ? 'Suspended' : server.installing ? 'Installing' : powerText(state)}
            </span>
        </li>
    );
}

/**
 * A searchable list of the servers the person can open: name, node, a description and whether it is online. Used by
 * the explorer headers of the dual workspace, one per server.
 */
export default function ServerPicker({ current, onPick, label }: Props) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlight, setHighlight] = useState(0);
    const trigger = useRef<HTMLButtonElement>(null);
    const popover = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
    const listId = useId();
    const servers = useServers(search, open);
    const items = servers.data ?? [];

    useLayoutEffect(() => {
        if (!open || !trigger.current) return;
        const rect = trigger.current.getBoundingClientRect();
        const width = Math.max(rect.width, 280);
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

    const choose = (server: PickableServer) => {
        setOpen(false);
        setSearch('');
        trigger.current?.focus();
        onPick(server);
    };

    return (
        <>
            <button
                ref={trigger}
                type={'button'}
                className={'gb-picker-trigger'}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                aria-label={`${label}: ${current?.name ?? 'choose a server'}. Change server`}
                onClick={() => setOpen((value) => !value)}
            >
                <span className={'gb-picker-text'}>
                    <strong>{current?.name ?? 'Choose a server'}</strong>
                    <small>{current?.node ?? ''}</small>
                </span>
                <ChevronsUpDown aria-hidden />
            </button>
            {open &&
                box &&
                createPortal(
                    <div
                        ref={popover}
                        className={'gb-picker-pop'}
                        style={{ left: box.left, top: box.top, width: box.width }}
                        role={'dialog'}
                        aria-label={`${label} server`}
                    >
                        <label className={'gb-picker-search'}>
                            <Search aria-hidden />
                            <input
                                autoFocus
                                value={search}
                                placeholder={'Search servers'}
                                aria-label={'Search servers'}
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
                                        if (picked) choose(picked);
                                    } else if (event.key === 'Escape') {
                                        event.stopPropagation();
                                        setOpen(false);
                                        trigger.current?.focus();
                                    }
                                }}
                            />
                        </label>
                        <ul id={listId} role={'listbox'} aria-label={'Servers'} className={'gb-picker-list'}>
                            {items.map((server, index) => (
                                <Item
                                    key={server.uuid}
                                    id={`${listId}-${index}`}
                                    server={server}
                                    active={index === highlight}
                                    withPower={index < 8}
                                    onPick={() => choose(server)}
                                />
                            ))}
                            {!servers.isPending && items.length === 0 && (
                                <li className={'gb-picker-empty'}>No server matches.</li>
                            )}
                            {servers.isPending && <li className={'gb-picker-empty'}>Loading servers…</li>}
                        </ul>
                    </div>,
                    document.body
                )}
        </>
    );
}
