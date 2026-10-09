import { Button, Dialog, toast, useCurrentServer, usePanelNavigate, type ReplacementProps } from '@pterodactyl/sdk';
import { Columns2, Menu, Rows2, SquareSplitVertical, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { listDirectory } from './api';
import { basename, join } from './paths';
import ServerPicker from './ServerPicker';
import TransferPanel from './TransferPanel';
import { fetchServers, usePowerState, useServerSummary, type PickableServer } from './servers';
import { mark } from './timing';
import { useTransfers, type Conflict, type TransferEnd, type TransferJob, type TransferMode } from './transfers';
import { usePane } from './usePane';
import type { TreeSource } from './useTree';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 520;
const SIDEBAR_KEY = 'gobia-files:sidebar';
const DUAL_KEY = 'gobia-files:dual';

type Orientation = 'stacked' | 'side';
type PaneId = 'a' | 'b';

interface DualState {
    on: boolean;
    layout: Orientation;
    second: string | null;
}

const readStored = (key: string, fallback: number) => {
    try {
        const value = Number(window.localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
        return fallback;
    }
};

const readDual = (): DualState => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(DUAL_KEY) ?? '{}') as Partial<DualState>;
        return {
            on: parsed.on === true,
            layout: parsed.layout === 'side' ? 'side' : 'stacked',
            second: parsed.second ? String(parsed.second) : null,
        };
    } catch {
        return { on: false, layout: 'stacked', second: null };
    }
};

/** What the layout needs from a pane to save its files and to move files between the two. */
interface PaneHandle {
    uuid: string;
    paneId: PaneId;
    activePath: string | null;
    save: (path: string) => Promise<boolean>;
    saveAll: () => Promise<void>;
    api: ReturnType<typeof usePane>['api'];
}

/** A draggable bar between two panes. `fraction` is the share of the first pane. */
function Splitter({
    direction,
    label,
    onChange,
}: {
    direction: 'row' | 'column';
    label: string;
    onChange: (fraction: number) => void;
}) {
    const bar = useRef<HTMLDivElement>(null);
    const vertical = direction === 'row'; // panes side by side: the bar is a vertical line
    const move = (clientX: number, clientY: number) => {
        const parent = bar.current?.parentElement?.getBoundingClientRect();
        if (!parent) return;
        const fraction = vertical ? (clientX - parent.left) / parent.width : (clientY - parent.top) / parent.height;
        onChange(Math.min(0.8, Math.max(0.2, fraction)));
    };

    return (
        <div
            ref={bar}
            role={'separator'}
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            aria-label={label}
            tabIndex={0}
            className={'gb-splitter ' + (vertical ? 'vertical' : 'horizontal')}
            onPointerDown={(event) => {
                event.preventDefault();
                const drag = (next: PointerEvent) => move(next.clientX, next.clientY);
                const up = () => {
                    window.removeEventListener('pointermove', drag);
                    window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', drag);
                window.addEventListener('pointerup', up);
            }}
            onKeyDown={(event) => {
                const step = 0.04;
                const back = vertical ? 'ArrowLeft' : 'ArrowUp';
                const forward = vertical ? 'ArrowRight' : 'ArrowDown';
                const parent = bar.current?.parentElement?.getBoundingClientRect();
                const first = bar.current?.previousElementSibling?.getBoundingClientRect();
                if (!parent || !first || (event.key !== back && event.key !== forward)) return;
                event.preventDefault();
                const current = vertical ? first.width / parent.width : first.height / parent.height;
                onChange(Math.min(0.8, Math.max(0.2, current + (event.key === forward ? step : -step))));
            }}
        />
    );
}

/** The header of one explorer in dual mode: which server it is, a way to change it, and whether it is online. */
function PaneHeader({
    paneId,
    uuid,
    onPick,
}: {
    paneId: PaneId;
    uuid: string;
    onPick: (server: PickableServer) => void;
}) {
    const summary = useServerSummary(uuid);
    const power = usePowerState(uuid);
    const state = power.data ?? null;

    return (
        <div className={'gb-pane-head'} data-pane-head={paneId}>
            <span className={'gb-pane-number'} aria-hidden>
                {paneId === 'a' ? '1' : '2'}
            </span>
            <ServerPicker
                label={`Server ${paneId === 'a' ? 1 : 2}`}
                current={summary.data ? { uuid, name: summary.data.name, node: summary.data.node } : null}
                onPick={onPick}
            />
            <span className={'gb-pane-state ' + (state === 'running' ? 'on' : '')}>
                {state === 'running' ? 'Online' : state ? 'Offline' : ''}
            </span>
        </div>
    );
}

/** The second server of the dual workspace: its own pane, rendered into the slots the layout provides. */
function SecondPane({
    uuid,
    slots,
    mobile,
    register,
    onFocus,
    onSaveAll,
    peer,
    onTransfer,
    onCrossDrop,
}: {
    uuid: string;
    slots: { explorer: HTMLElement | null; editor: HTMLElement | null };
    mobile: boolean;
    register: (handle: PaneHandle | null) => void;
    onFocus: () => void;
    onSaveAll: () => void;
    peer: { name: string; canWrite: boolean } | null;
    onTransfer: (paths: string[], mode: TransferMode, directory?: string) => void;
    onCrossDrop: (origin: string, paths: string[], directory: string, copy: boolean) => void;
}) {
    const summary = useServerSummary(uuid);
    const permissions = summary.data?.permissions ?? { create: false, update: false, delete: false, archive: false };
    const pane = usePane({
        uuid,
        paneId: 'b',
        permissions,
        treeSource: 'fetch' satisfies TreeSource,
        mobile,
        onFocusPane: onFocus,
        onSaveAll,
        peer,
        onTransfer,
        onCrossDrop,
    });
    const { api, save, saveAll, active } = pane;
    useEffect(() => {
        register({ uuid, paneId: 'b', activePath: active?.path ?? null, save, saveAll, api });
        return () => register(null);
    });

    return (
        <>
            {slots.explorer && createPortal(pane.explorer, slots.explorer)}
            {slots.editor && createPortal(pane.editor, slots.editor)}
            {pane.overlays}
        </>
    );
}

export default function Workspace({ model }: ReplacementProps<'server.files.manager'>) {
    const uuid = useCurrentServer((server) => server.attributes.uuid) ?? '';
    const navigate = usePanelNavigate();
    // The Panel has usually listed the root already; the explorer takes that listing instead of asking again.
    const [waited, setWaited] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setWaited(true), 1500);
        return () => window.clearTimeout(timer);
    }, []);
    const treeSource = useMemo<TreeSource>(() => {
        if (model.directory !== '/' || model.truncated) return 'fetch';
        if (model.loading) return waited ? 'fetch' : 'wait';
        if (model.entries.length === 0 || model.entries.some((entry) => entry.kind === 'symlink')) return 'fetch';
        return model.entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            directory: entry.kind === 'directory',
            size: entry.size,
            mimetype: entry.mimetype,
            modifiedAt: entry.modifiedAt,
        }));
    }, [model.directory, model.truncated, model.loading, model.entries, waited]);

    const [drawer, setDrawer] = useState(false);
    const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
    const [sidebar, setSidebar] = useState(() => readStored(SIDEBAR_KEY, 288));
    const [dual, setDual] = useState<DualState>(readDual);
    const [explorerSplit, setExplorerSplit] = useState(0.5);
    const [editorSplit, setEditorSplit] = useState(0.5);
    const [focused, setFocused] = useState<PaneId>('a');
    const [closing, setClosing] = useState(false);
    const [slots, setSlots] = useState<{ explorer: HTMLElement | null; editor: HTMLElement | null }>({
        explorer: null,
        editor: null,
    });
    const panes = useRef<{ a: PaneHandle | null; b: PaneHandle | null }>({ a: null, b: null });
    const focusedRef = useRef<PaneId>('a');
    focusedRef.current = focused;

    useEffect(() => {
        const query = window.matchMedia('(max-width: 767px)');
        const change = () => setMobile(query.matches);
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, []);
    useEffect(() => {
        try {
            window.localStorage.setItem(DUAL_KEY, JSON.stringify(dual));
        } catch {
            // The layout is simply not remembered.
        }
    }, [dual]);

    const summaryA = useServerSummary(uuid);
    const secondUuid = dual.on ? (dual.second ?? uuid) : null;
    const summaryB = useServerSummary(secondUuid);
    const dualOn = dual.on && secondUuid !== null;

    // ---- transfers between the two servers ----------------------------------------------------------------------
    const handleOf = (pane: PaneId) => panes.current[pane];
    const transfers = useTransfers({
        onItem: (job, result) => {
            const destination = handleOf(job.destination.pane);
            const source = handleOf(job.source.pane);
            // Select what arrived once the listing shows it, so the selection is never pruned as a ghost.
            const arrived =
                result.status === 'copied' || result.status === 'moved' || result.status === 'move_incomplete';
            // The folder it landed in opens (once something was dropped in) so the arrival is visible.
            if (arrived) destination?.api.tree.expand(job.directory);
            void destination?.api.tree.reload([job.directory], true).then(() => {
                if (arrived) destination.api.select([join(job.directory, result.name)]);
            });
            if (job.mode === 'move' && result.status === 'moved') {
                // Tabs of what moved follow it: closed on the old server, opened at the new identity on the new one.
                const open = source?.api.openUnder(result.path) ?? [];
                const landed = result.destination ?? join(job.directory, result.name);
                source?.api.closeGone([result.path]);
                for (const path of open) void destination?.api.openPath(landed + path.slice(result.path.length));
                void source?.api.tree.reload([result.path.slice(0, Math.max(1, result.path.lastIndexOf('/')))], true);
            }
        },
        onFinish: (job: TransferJob) => {
            const failed = job.results.filter(
                (result) => result.status === 'failed' || result.status === 'partial'
            ).length;
            const kept = job.results.filter((result) => result.status === 'move_incomplete').length;
            const done = job.results.filter((result) => result.status === 'copied' || result.status === 'moved').length;
            if (job.status === 'cancelled') toast.message('Transfer cancelled.');
            else if (kept > 0)
                toast.error(
                    `${kept} item${kept === 1 ? ' was' : 's were'} copied and verified, but the original${kept === 1 ? ' is' : 's are'} still on ${job.source.name}. Nothing was lost: use Finish in the transfer list.`
                );
            else if (failed > 0) toast.error(`${failed} of ${job.items.length} could not be transferred.`);
            else if (done > 0)
                toast.success(
                    `${job.mode === 'move' ? 'Moved' : 'Copied'} ${done} item${done === 1 ? '' : 's'} to ${job.destination.name}.`
                );
        },
    });
    const [conflict, setConflict] = useState<{
        names: string[];
        proceed: (choice: Conflict | null) => void;
    } | null>(null);

    const [unsavedMove, setUnsavedMove] = useState<{
        names: string[];
        proceed: (choice: 'save' | 'discard' | null) => void;
    } | null>(null);

    const endOf = (pane: PaneId): TransferEnd | null => {
        const handle = handleOf(pane);
        const summary = pane === 'a' ? summaryA.data : summaryB.data;
        return handle && summary ? { pane, uuid: handle.uuid, name: summary.name } : null;
    };

    /** Copy (default) or move the paths of one pane into a folder of the other, asking about name collisions first. */
    const startTransfer = useCallback(
        async (from: PaneId, paths: string[], mode: TransferMode, directory = '/') => {
            const to: PaneId = from === 'a' ? 'b' : 'a';
            const source = endOf(from);
            const destination = endOf(to);
            const sender = handleOf(from);
            const receiver = handleOf(to);
            if (!source || !destination || !sender || !receiver) return;

            let items = paths;
            // A file with unsaved edits is never moved from its older disk version: the person decides first.
            const unsaved = mode === 'move' ? items.filter((path) => sender.api.hasUnsaved(path)) : [];
            if (unsaved.length > 0) {
                const choice = await new Promise<'save' | 'discard' | null>((resolve) =>
                    setUnsavedMove({ names: unsaved.map(basename), proceed: resolve })
                );
                setUnsavedMove(null);
                if (choice === null) return;
                for (const path of unsaved) {
                    if (choice === 'save') {
                        // eslint-disable-next-line no-await-in-loop
                        if (!(await sender.api.saveUnder(path))) {
                            toast.error(`${basename(path)} could not be saved, so nothing was moved.`);
                            return;
                        }
                    } else {
                        sender.api.discardUnder(path);
                    }
                }
            }

            let existing: string[] = [];
            try {
                const listing = await listDirectory(destination.uuid, directory);
                const taken = new Set(listing.map((entry) => entry.name));
                existing = items.map(basename).filter((name) => taken.has(name));
            } catch {
                // The destination folder could not be listed: the Panel decides per file, and skips what exists.
            }
            let policy: Conflict = 'skip';
            if (existing.length > 0) {
                const choice = await new Promise<Conflict | null>((resolve) =>
                    setConflict({ names: existing, proceed: resolve })
                );
                setConflict(null);
                if (choice === null) return;
                policy = choice;
                if (policy === 'replace') {
                    items = items.filter((path) => {
                        const target = join(directory, basename(path));
                        if (receiver.api.hasUnsaved(target)) {
                            toast.error(
                                `${basename(path)} is open with unsaved changes in ${destination.name}. It was not replaced.`
                            );
                            return false;
                        }
                        return true;
                    });
                    if (items.length === 0) return;
                }
            }
            mark('transfer-start');
            const kinds: Record<string, 'file' | 'directory'> = {};
            for (const path of items) {
                const kind = sender.api.kindOf(path);
                if (kind) kinds[path] = kind;
            }
            transfers.start({ mode, conflict: policy, source, destination, directory, items, kinds });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [transfers.start, summaryA.data, summaryB.data]
    );

    const pickFirst = async () => {
        try {
            const list = await fetchServers('');
            return list.find((server) => server.uuid !== uuid)?.uuid ?? uuid;
        } catch {
            return uuid;
        }
    };

    const enableDual = async () => {
        const second = dual.second ?? (await pickFirst());
        setDual({ on: true, layout: dual.layout, second });
        mark('dual-activated');
    };
    const disableDual = () => {
        const dirty = panes.current.b?.api.dirtyCount ?? 0;
        if (dirty > 0) setClosing(true);
        else setDual({ ...dual, on: false });
    };

    // ---- panes ---------------------------------------------------------------------------------------------------
    const peerForA =
        dualOn && summaryB.data && summaryA.data?.canReadContent
            ? { name: summaryB.data.name, canWrite: summaryB.data.permissions.create }
            : null;
    const peerForB =
        dualOn && summaryA.data && summaryB.data?.canReadContent
            ? { name: summaryA.data.name, canWrite: summaryA.data.permissions.create }
            : null;

    const saveEverything = useCallback(() => {
        void panes.current.a?.saveAll();
        void panes.current.b?.saveAll();
    }, []);

    const pane = usePane({
        uuid,
        paneId: 'a',
        permissions: model.permissions,
        treeSource,
        mobile,
        onNavigate: () => setDrawer(false),
        onFocusPane: () => setFocused('a'),
        onSaveAll: saveEverything,
        peer: peerForA,
        onTransfer: (paths, mode, directory) => void startTransfer('a', paths, mode, directory),
        onCrossDrop: (origin, paths, directory, copy) =>
            void startTransfer(origin as PaneId, paths, copy ? 'copy' : 'move', directory),
    });
    panes.current.a = {
        uuid,
        paneId: 'a',
        activePath: pane.active?.path ?? null,
        save: pane.save,
        saveAll: pane.saveAll,
        api: pane.api,
    };
    const registerSecond = useCallback((handle: PaneHandle | null) => {
        panes.current.b = handle;
    }, []);

    // The browser's own Save Page shortcut belongs to the workspace while it is open. Monaco handles it itself while it
    // has focus; everywhere else (explorer, tab strip, empty page) this listener does, and always cancels the default.
    // In dual mode the pane the person last touched is the one that saves.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            mark('save-key');
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('.monaco-editor')) return;
            const inside = target?.closest?.('[data-pane]')?.getAttribute('data-pane') as PaneId | null | undefined;
            const handle = panes.current[inside ?? focusedRef.current] ?? panes.current.a;
            if (!handle) return;
            if (event.shiftKey) {
                saveEverything();
            } else if (handle.activePath) {
                void handle.save(handle.activePath);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [saveEverything]);

    const startResize = (event: React.PointerEvent) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = sidebar;
        const move = (next: PointerEvent) =>
            setSidebar(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + next.clientX - startX)));
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setSidebar((width) => {
                try {
                    window.localStorage.setItem(SIDEBAR_KEY, String(width));
                } catch {
                    // The width simply is not remembered.
                }
                return width;
            });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    const pickA = (server: PickableServer) => {
        if (server.uuid === uuid) return;
        mark('server-switch');
        void navigate({ to: '/server/$id/files', params: { id: server.identifier } });
    };
    const pickB = (server: PickableServer) => setDual((current) => ({ ...current, second: server.uuid }));

    const stacked = dual.layout === 'stacked';
    const shown = mobile ? focused : null; // on a phone one server at a time
    const paneStyle = (id: PaneId): React.CSSProperties => ({
        display: mobile && shown !== id ? 'none' : 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        flex: mobile ? 1 : id === 'a' ? editorSplit : 1 - editorSplit,
    });
    // Stable callbacks: a new ref function on every render would be called again each time and loop.
    const explorerSlot = useCallback(
        (element: HTMLElement | null) =>
            setSlots((current) => (current.explorer === element ? current : { ...current, explorer: element })),
        []
    );
    const editorSlot = useCallback(
        (element: HTMLElement | null) =>
            setSlots((current) => (current.editor === element ? current : { ...current, editor: element })),
        []
    );

    const explorerFor = (id: PaneId): ReactNode =>
        id === 'a' ? pane.explorer : <div className={'gb-pane-body'} ref={explorerSlot} />;

    const head = (
        <div className={'gb-workspace-head'}>
            <button
                type={'button'}
                aria-label={mobile ? (drawer ? 'Hide file explorer' : 'Show file explorer') : 'Files'}
                aria-expanded={drawer}
                onClick={() => setDrawer((open) => !open)}
                className={'gb-icon-btn gb-icon-btn-sm'}
                style={mobile ? undefined : { display: 'none' }}
                tabIndex={mobile ? 0 : -1}
            >
                <Menu aria-hidden />
            </button>
            <p className={'gb-workspace-path'} title={pane.state.active ?? ''}>
                {pane.state.active ?? 'File editor'}
            </p>
            {dualOn && mobile && (
                <div className={'gb-segmented'} role={'group'} aria-label={'Server'}>
                    {(['a', 'b'] as const).map((id) => (
                        <button
                            key={id}
                            type={'button'}
                            aria-pressed={focused === id}
                            className={focused === id ? 'active' : undefined}
                            onClick={() => setFocused(id)}
                        >
                            Server {id === 'a' ? 1 : 2}
                        </button>
                    ))}
                </div>
            )}
            <div className={'gb-layout-controls'} role={'group'} aria-label={'Workspace layout'}>
                {dualOn ? (
                    <>
                        {!mobile && (
                            <div className={'gb-segmented'} role={'group'} aria-label={'Editor layout'}>
                                <button
                                    type={'button'}
                                    aria-pressed={stacked}
                                    className={stacked ? 'active' : undefined}
                                    title={'Stacked: one editor above the other'}
                                    onClick={() => {
                                        setDual({ ...dual, layout: 'stacked' });
                                        mark('layout-change');
                                    }}
                                >
                                    <Rows2 aria-hidden /> Stacked
                                </button>
                                <button
                                    type={'button'}
                                    aria-pressed={!stacked}
                                    className={!stacked ? 'active' : undefined}
                                    title={'Side by side: editors next to each other'}
                                    onClick={() => {
                                        setDual({ ...dual, layout: 'side' });
                                        mark('layout-change');
                                    }}
                                >
                                    <Columns2 aria-hidden /> Side by side
                                </button>
                            </div>
                        )}
                        <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={disableDual}>
                            <X aria-hidden /> Single
                        </button>
                    </>
                ) : (
                    <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => void enableDual()}>
                        <SquareSplitVertical aria-hidden /> Dual servers
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <div className={'gb-page'} data-dual={dualOn ? 'true' : 'false'}>
            {head}

            <div className={'gb-workspace'} style={{ height: 'calc(100dvh - 11rem)', minHeight: 420 }}>
                {!mobile && (
                    <>
                        <aside className={'gb-explorer'} style={{ width: sidebar }} aria-label={'File explorer'}>
                            <div
                                className={'gb-pane'}
                                data-pane={'a'}
                                style={{ flex: dualOn ? explorerSplit : 1 }}
                                onFocusCapture={() => setFocused('a')}
                                onPointerDownCapture={() => setFocused('a')}
                            >
                                {dualOn && <PaneHeader paneId={'a'} uuid={uuid} onPick={pickA} />}
                                {pane.explorer}
                            </div>
                            {dualOn && (
                                <>
                                    <Splitter
                                        direction={'column'}
                                        label={'Resize the two explorers'}
                                        onChange={setExplorerSplit}
                                    />
                                    <div
                                        className={'gb-pane'}
                                        data-pane={'b'}
                                        style={{ flex: 1 - explorerSplit }}
                                        onFocusCapture={() => setFocused('b')}
                                        onPointerDownCapture={() => setFocused('b')}
                                    >
                                        {secondUuid && <PaneHeader paneId={'b'} uuid={secondUuid} onPick={pickB} />}
                                        {explorerFor('b')}
                                    </div>
                                </>
                            )}
                        </aside>
                        <div
                            role={'separator'}
                            aria-orientation={'vertical'}
                            aria-valuenow={sidebar}
                            aria-valuemin={MIN_SIDEBAR}
                            aria-valuemax={MAX_SIDEBAR}
                            aria-label={'Resize file explorer'}
                            tabIndex={0}
                            onPointerDown={startResize}
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowLeft') setSidebar((width) => Math.max(MIN_SIDEBAR, width - 16));
                                if (event.key === 'ArrowRight')
                                    setSidebar((width) => Math.min(MAX_SIDEBAR, width + 16));
                            }}
                            className={'gb-resizer'}
                        />
                    </>
                )}

                <section
                    aria-label={'Editor'}
                    className={'gb-editors'}
                    data-layout={dualOn && !mobile ? dual.layout : 'single'}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: dualOn && !mobile && !stacked ? 'row' : 'column',
                    }}
                >
                    <div
                        className={'gb-editor-pane'}
                        data-pane={'a'}
                        style={
                            dualOn
                                ? paneStyle('a')
                                : { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }
                        }
                        onFocusCapture={() => setFocused('a')}
                        onPointerDownCapture={() => setFocused('a')}
                    >
                        {dualOn && (
                            <div className={'gb-editor-label'}>
                                <span className={'gb-pane-number'} aria-hidden>
                                    1
                                </span>
                                {summaryA.data?.name ?? ''}
                            </div>
                        )}
                        {pane.editor}
                    </div>
                    {dualOn && !mobile && (
                        <Splitter
                            direction={stacked ? 'column' : 'row'}
                            label={'Resize the two editors'}
                            onChange={setEditorSplit}
                        />
                    )}
                    {dualOn && (
                        <div
                            className={'gb-editor-pane'}
                            data-pane={'b'}
                            style={paneStyle('b')}
                            onFocusCapture={() => setFocused('b')}
                            onPointerDownCapture={() => setFocused('b')}
                        >
                            <div className={'gb-editor-label'}>
                                <span className={'gb-pane-number'} aria-hidden>
                                    2
                                </span>
                                {summaryB.data?.name ?? ''}
                            </div>
                            <div className={'gb-pane-body'} ref={editorSlot} />
                        </div>
                    )}
                </section>

                {mobile && drawer && (
                    <>
                        <div className={'gb-drawer-mask'} onClick={() => setDrawer(false)} aria-hidden />
                        <aside className={'gb-drawer'} aria-label={'File explorer'}>
                            {dualOn && (
                                <PaneHeader
                                    paneId={focused}
                                    uuid={focused === 'a' ? uuid : (secondUuid ?? uuid)}
                                    onPick={focused === 'a' ? pickA : pickB}
                                />
                            )}
                            {/* Both explorers stay mounted; the drawer shows the one of the server being edited. */}
                            <div className={'gb-pane-body'} style={{ display: focused === 'a' ? 'flex' : 'none' }}>
                                {pane.explorer}
                            </div>
                            {dualOn && (
                                <div
                                    className={'gb-pane-body'}
                                    style={{ display: focused === 'b' ? 'flex' : 'none' }}
                                    ref={explorerSlot}
                                />
                            )}
                        </aside>
                    </>
                )}
            </div>

            {dualOn && secondUuid && (
                <SecondPane
                    key={'b'}
                    uuid={secondUuid}
                    slots={slots}
                    mobile={mobile}
                    register={registerSecond}
                    onFocus={() => setFocused('b')}
                    onSaveAll={saveEverything}
                    peer={peerForB}
                    onTransfer={(paths, mode, directory) => void startTransfer('b', paths, mode, directory)}
                    onCrossDrop={(origin, paths, directory, copy) =>
                        void startTransfer(origin as PaneId, paths, copy ? 'copy' : 'move', directory)
                    }
                />
            )}

            {pane.overlays}

            <TransferPanel
                jobs={transfers.jobs}
                onCancel={transfers.cancel}
                onRetry={transfers.retry}
                onClear={transfers.clear}
            />

            {conflict && (
                <Dialog
                    open
                    onClose={() => conflict.proceed(null)}
                    title={
                        conflict.names.length === 1
                            ? `${conflict.names[0]} already exists`
                            : `${conflict.names.length} items already exist`
                    }
                    description={
                        conflict.names.length === 1
                            ? 'Something with that name is in the destination folder. Choose what happens to it.'
                            : `${conflict.names.slice(0, 4).join(', ')}${conflict.names.length > 4 ? ' and more' : ''} are in the destination folder. The choice applies to all of them.`
                    }
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => conflict.proceed(null)}>
                            Cancel
                        </Button.Text>
                        <Button type={'button'} onClick={() => conflict.proceed('skip')}>
                            Skip
                        </Button>
                        <Button type={'button'} onClick={() => conflict.proceed('keep')}>
                            Keep both
                        </Button>
                        <Button type={'button'} color={'primary'} onClick={() => conflict.proceed('replace')}>
                            Replace
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}

            {unsavedMove && (
                <Dialog
                    open
                    onClose={() => unsavedMove.proceed(null)}
                    title={
                        unsavedMove.names.length === 1
                            ? `${unsavedMove.names[0]} has unsaved changes`
                            : `${unsavedMove.names.length} items have unsaved changes`
                    }
                    description={
                        'Moving would use the older version saved on the server. Save the changes first, or discard them and move what is saved.'
                    }
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => unsavedMove.proceed(null)}>
                            Cancel
                        </Button.Text>
                        <Button type={'button'} onClick={() => unsavedMove.proceed('discard')}>
                            Discard changes and move
                        </Button>
                        <Button type={'button'} color={'primary'} onClick={() => unsavedMove.proceed('save')}>
                            Save and move
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}

            {closing && (
                <Dialog
                    open
                    onClose={() => setClosing(false)}
                    title={'Server 2 has unsaved changes'}
                    description={
                        'Save them now, or close the second server and keep them: they come back when you open it again in this tab.'
                    }
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setClosing(false)}>
                            Cancel
                        </Button.Text>
                        <Button
                            type={'button'}
                            onClick={() => {
                                setClosing(false);
                                setDual({ ...dual, on: false });
                            }}
                        >
                            Close and keep changes
                        </Button>
                        <Button
                            type={'button'}
                            color={'primary'}
                            onClick={() => {
                                setClosing(false);
                                void panes.current.b?.saveAll().then(() => setDual({ ...dual, on: false }));
                            }}
                        >
                            Save all and close
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}
        </div>
    );
}
