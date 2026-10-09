import { ChevronDown, ChevronRight, Ellipsis } from 'lucide-react';
import {
    memo,
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from 'react';
import FileTypeIcon from './FileTypeIcon';
import type { TreeEntry } from './api';
import { basename, dirname } from './paths';
import type { Listing, TreeState } from './useTree';

export const MOVE_TYPE = 'application/x-gobia-file';
/** Names the pane a drag started in (the type itself carries it, because only types are readable while dragging over). */
export const PANE_TYPE_PREFIX = 'application/x-gobia-pane-';
export const originOf = (types: readonly string[]) =>
    types.find((type) => type.startsWith(PANE_TYPE_PREFIX))?.slice(PANE_TYPE_PREFIX.length) ?? null;
export const ROOT = '/';

export type SelectMode = 'single' | 'toggle' | 'range';

/** The paths in the order the explorer shows them, folders only when they are expanded. */
export function visiblePaths(tree: TreeState): string[] {
    const out: string[] = [];
    const walk = (path: string) => {
        const listing = tree.listings[path];
        if (!listing || listing === 'loading' || !('items' in listing)) return;
        for (const item of listing.items) {
            out.push(item.path);
            if (item.directory && tree.expanded.has(item.path)) walk(item.path);
        }
    };
    walk(ROOT);
    return out;
}

/** Why `name` cannot be used for an entry in a folder that already holds `taken`, or null when it can. */
export function nameProblem(name: string, taken: ReadonlySet<string>): string | null {
    const value = name.trim();
    if (value === '') return 'Enter a name.';
    if (value === '.' || value === '..' || value.includes('/')) return 'That name is not allowed.';
    if (taken.has(value)) return 'Something with that name already exists here.';
    return null;
}

/** A folder that is not the dragged entry, its parent (nothing would change) or inside it (it would swallow itself). */
export const validTarget = (dragged: string, directory: string, taken?: ReadonlySet<string>) =>
    dragged !== directory &&
    dirname(dragged) !== directory &&
    !directory.startsWith(`${dragged}/`) &&
    !dragged.split('/').includes('..') &&
    !(taken?.has(basename(dragged)) ?? false);

export type Inline =
    | { kind: 'create'; what: 'file' | 'folder'; directory: string }
    | { kind: 'rename'; entry: TreeEntry };

function InlineName({
    depth,
    initial,
    label,
    folder,
    taken,
    onSubmit,
    onCancel,
}: {
    depth: number;
    initial: string;
    label: string;
    folder: boolean;
    taken: ReadonlySet<string>;
    onSubmit: (name: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    const input = useRef<HTMLInputElement>(null);
    const problem = value === initial ? null : nameProblem(value, taken);
    useEffect(() => {
        const element = input.current;
        if (!element) return;
        element.focus();
        // Renaming selects the stem, so typing keeps the extension like in an editor.
        const dot = initial.lastIndexOf('.');
        element.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, [initial]);
    return (
        <div className={'gb-tree-row inline' + (problem && value !== '' ? ' invalid' : '')}>
            <div className={'gb-tree-inline'} style={{ paddingLeft: depth * 14 + 8 }}>
                <span className={'gb-tree-chevron'} />
                <FileTypeIcon name={initial || (folder ? 'folder' : 'file')} folder={folder} />
                <input
                    ref={input}
                    className={'gb-tree-input'}
                    value={value}
                    aria-label={label}
                    aria-invalid={problem !== null && value !== ''}
                    title={problem ?? undefined}
                    spellCheck={false}
                    autoComplete={'off'}
                    onChange={(event) => setValue(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') onCancel();
                        else if (event.key === 'Enter') {
                            event.preventDefault();
                            if (value.trim() === initial) onCancel();
                            else if (!nameProblem(value, taken)) onSubmit(value.trim());
                        }
                    }}
                    onBlur={onCancel}
                />
            </div>
            {problem && value !== '' && (
                <span role={'alert'} className={'gb-tree-problem'}>
                    {problem}
                </span>
            )}
        </div>
    );
}

interface TreeProps {
    tree: TreeState;
    selection: ReadonlySet<string>;
    activePath: string | null;
    openPaths: ReadonlySet<string>;
    dirtyPaths: ReadonlySet<string>;
    canMove: boolean;
    canUpload: boolean;
    /** Which pane this explorer is, so a drag from the other explorer is a transfer and not a move. */
    paneId: string;
    /** Files dropped here from the other explorer (copy by default). */
    onCrossDrop?: (origin: string, paths: string[], directory: string, copy: boolean) => void;
    onSelect: (path: string, mode: SelectMode) => void;
    /** Keyboard arrows move the selection to the previous or next visible path. */
    onClear: () => void;
    /** Called when a drag starts on `path`; returns the paths that travel (the selection, or just that path). */
    onDragSelect: (path: string) => string[];
    onOpen: (entry: TreeEntry) => void;
    /** A right click, the menu key or the three dot button; `entry` is null for the root. */
    onMenu: (entry: TreeEntry | null, x: number, y: number) => void;
    onMove: (from: string[], toDirectory: string) => void;
    onDropFiles: (data: DataTransfer, directory: string) => void;
    /** An entry being created or renamed in place. */
    inline: Inline | null;
    onInlineSubmit: (name: string) => void;
    onInlineCancel: () => void;
    /** The path that just landed after a move; it settles with a short highlight. */
    settled: string | null;
}

/** What a row calls. One object for the whole tree whose functions never change, so a row that did not change is not drawn again. */
interface Handlers {
    click: (entry: TreeEntry | null, event: MouseEvent) => void;
    menu: (entry: TreeEntry | null, x: number, y: number) => void;
    dragStart: (path: string) => string[];
    move: TreeProps['onMove'];
    dropFiles: TreeProps['onDropFiles'];
    crossDrop: (origin: string, paths: string[], directory: string, copy: boolean) => void;
    /** The names in one folder as the explorer lists them now (read when something is dragged over, not on every draw). */
    namesIn: (path: string) => ReadonlySet<string>;
}

interface RowProps {
    entry: TreeEntry | null;
    depth: number;
    open: boolean;
    selected: boolean;
    active: boolean;
    dragged: boolean;
    openFile: boolean;
    dirty: boolean;
    canMove: boolean;
    canUpload: boolean;
    canCross: boolean;
    paneId: string;
    h: Handlers;
    /** The paths being dragged anywhere in the tree. */
    dragging: readonly string[] | null;
    onDragging: (paths: readonly string[] | null) => void;
    settled: boolean;
}

const Row = memo(function Row({
    entry,
    depth,
    open,
    selected,
    active,
    dragged,
    openFile,
    dirty,
    canMove,
    canUpload,
    canCross,
    paneId,
    h,
    dragging,
    onDragging,
    settled,
}: RowProps) {
    const directory = entry === null || entry.directory;
    const path = entry?.path ?? ROOT;
    const [over, setOver] = useState<'ok' | 'denied' | null>(null);
    // What a drop from the other explorer would do: it moves, and copies while Ctrl (or Cmd) is held.
    const [operation, setOperation] = useState<'move' | 'copy' | null>(null);
    const Chevron = open ? ChevronDown : ChevronRight;

    const dragOver = (event: DragEvent) => {
        if (!directory) return;
        const types = event.dataTransfer.types;
        const origin = originOf(types);
        const cross = origin !== null && origin !== paneId;
        const internal = types.includes(MOVE_TYPE) && !cross;
        const allowed = cross
            ? canUpload && canCross
            : internal
              ? canMove && (dragging === null || dragging.every((item) => validTarget(item, path, h.namesIn(path))))
              : canUpload;
        event.preventDefault();
        const copying = event.ctrlKey || event.metaKey;
        event.dataTransfer.dropEffect = allowed ? (internal || (cross && !copying) ? 'move' : 'copy') : 'none';
        const next = allowed ? 'ok' : 'denied';
        if (over !== next) setOver(next);
        const op = allowed && cross ? (copying ? 'copy' : 'move') : null;
        if (operation !== op) setOperation(op);
    };

    const drop = (event: DragEvent) => {
        if (!directory) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(null);
        setOperation(null);
        // The dragged row may unmount once the move lands, so its own dragend can never clear the highlights.
        onDragging(null);
        const moved = event.dataTransfer.getData(MOVE_TYPE);
        const origin = originOf(event.dataTransfer.types);
        if (moved && origin !== null && origin !== paneId) {
            if (canUpload) h.crossDrop(origin, JSON.parse(moved) as string[], path, event.ctrlKey || event.metaKey);
        } else if (moved) {
            if (canMove) h.move(JSON.parse(moved) as string[], path);
        } else if (canUpload) {
            h.dropFiles(event.dataTransfer, path);
        }
    };

    return (
        <div
            className={
                'gb-tree-row' +
                (entry === null ? ' root' : '') +
                (selected ? ' selected' : active ? ' active-file' : '') +
                (dragged ? ' dragged' : '') +
                (settled ? ' settled' : '') +
                (over === 'ok' ? ' drop-ok' : over === 'denied' ? ' drop-denied' : '')
            }
            onDragOver={dragOver}
            onDragLeave={() => {
                setOver(null);
                setOperation(null);
            }}
            onDrop={drop}
            data-operation={operation ?? undefined}
        >
            <button
                type={'button'}
                aria-current={selected || active ? 'true' : undefined}
                aria-pressed={entry ? selected : undefined}
                data-path={entry ? entry.path : undefined}
                aria-expanded={directory ? open : undefined}
                draggable={entry !== null && canMove}
                onDragStart={(event) => {
                    if (!entry) return;
                    const traveling = h.dragStart(entry.path);
                    event.dataTransfer.setData(MOVE_TYPE, JSON.stringify(traveling));
                    event.dataTransfer.setData(`${PANE_TYPE_PREFIX}${paneId}`, paneId);
                    event.dataTransfer.effectAllowed = 'copyMove';
                    // A compact chip instead of the browser's translucent copy of the whole row.
                    const chip = document.createElement('div');
                    chip.className = 'gb-drag-chip';
                    chip.textContent =
                        traveling.length > 1 ? `${entry.name} and ${traveling.length - 1} more` : entry.name;
                    document.body.append(chip);
                    event.dataTransfer.setDragImage(chip, 12, 12);
                    window.setTimeout(() => chip.remove(), 0);
                    onDragging(traveling);
                }}
                onDragEnd={() => onDragging(null)}
                onClick={(event) => h.click(entry, event)}
                onContextMenu={(event) => {
                    event.preventDefault();
                    h.menu(entry, event.clientX, event.clientY);
                }}
                style={{ paddingLeft: depth * 14 + 8 }}
                title={path}
            >
                {directory ? (
                    <>
                        {entry ? <Chevron className={'gb-tree-chevron'} aria-hidden /> : null}
                        <FileTypeIcon name={entry?.name ?? ''} folder open={open} root={entry === null} />
                    </>
                ) : (
                    <>
                        <span className={'gb-tree-chevron'} />
                        <FileTypeIcon name={entry?.name ?? ''} />
                    </>
                )}
                <span className={'gb-tree-name' + (openFile ? ' open' : '')}>
                    {entry ? entry.name : '/home/container'}
                </span>
                {dirty && (
                    <span aria-label={'unsaved changes'} className={'gb-tree-dirty'}>
                        &bull;
                    </span>
                )}
            </button>
            {entry && (
                <button
                    type={'button'}
                    className={'gb-tree-more'}
                    aria-label={`Actions for ${entry.name}`}
                    aria-haspopup={'menu'}
                    onClick={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        h.menu(entry, box.right, box.bottom);
                    }}
                >
                    <Ellipsis aria-hidden />
                </button>
            )}
        </div>
    );
});

const namesOf = (listing: Listing | undefined): ReadonlySet<string> =>
    new Set(listing && listing !== 'loading' && 'items' in listing ? listing.items.map((item) => item.name) : []);

export default function Tree(props: TreeProps) {
    const { tree, selection, activePath, openPaths, dirtyPaths, canMove, canUpload, inline } = props;
    const [dragging, setDragging] = useState<readonly string[] | null>(null);
    // The handlers read the newest props through this ref, so they can stay the same object for the life of the tree.
    const latest = useRef(props);
    latest.current = props;
    const handlers = useMemo<Handlers>(
        () => ({
            click: (entry, event) => {
                const current = latest.current;
                if (entry === null) {
                    current.onSelect(ROOT, 'single');
                    return;
                }
                const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'single';
                current.onSelect(entry.path, mode);
                if (mode !== 'single') return;
                if (entry.directory) current.tree.toggle(entry.path);
                else current.onOpen(entry);
            },
            menu: (entry, x, y) => {
                const current = latest.current;
                // A right click inside the selection keeps it; elsewhere it selects just that entry.
                if (entry === null) current.onSelect(ROOT, 'single');
                else if (!current.selection.has(entry.path)) current.onSelect(entry.path, 'single');
                current.onMenu(entry, x, y);
            },
            dragStart: (path) => latest.current.onDragSelect(path),
            move: (from, to) => latest.current.onMove(from, to),
            dropFiles: (data, directory) => latest.current.onDropFiles(data, directory),
            crossDrop: (origin, paths, directory, copy) => latest.current.onCrossDrop?.(origin, paths, directory, copy),
            namesIn: (path) => namesOf(latest.current.tree.listings[path]),
        }),
        []
    );

    const arrows = (event: KeyboardEvent) => {
        const key = event.key;
        if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button[data-path]')];
        const at = buttons.findIndex((button) => button === document.activeElement);
        const next = buttons[Math.max(0, Math.min(buttons.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))];
        if (!next) return;
        event.preventDefault();
        next.focus();
        props.onSelect(next.dataset.path ?? ROOT, event.shiftKey ? 'range' : 'single');
    };

    const canCross = props.onCrossDrop !== undefined;
    const creating = (path: string) => inline?.kind === 'create' && inline.directory === path;
    const newRow = (path: string, depth: number) =>
        inline?.kind === 'create' && inline.directory === path ? (
            <InlineName
                key={'new'}
                depth={depth}
                initial={''}
                label={inline.what === 'file' ? 'File name' : 'Folder name'}
                folder={inline.what === 'folder'}
                taken={namesOf(tree.listings[path])}
                onSubmit={props.onInlineSubmit}
                onCancel={props.onInlineCancel}
            />
        ) : null;

    const directory = (path: string, depth: number): ReactNode => {
        const listing = tree.listings[path];
        const note = (text: string, error = false) => (
            <div className={'gb-tree-note' + (error ? ' error' : '')} style={{ paddingLeft: depth * 14 + 32 }}>
                {text}
            </div>
        );
        if (!listing || listing === 'loading') return note('Loading…');
        if ('error' in listing) return note(listing.error, true);
        if (listing.items.length === 0) return creating(path) ? newRow(path, depth) : note('Empty');

        return [
            newRow(path, depth),
            ...listing.items.map((entry) => {
                const open = entry.directory && tree.expanded.has(entry.path);
                if (inline?.kind === 'rename' && inline.entry.path === entry.path) {
                    return (
                        <InlineName
                            key={entry.path}
                            depth={depth}
                            initial={entry.name}
                            label={'New name'}
                            folder={entry.directory}
                            taken={namesOf(listing)}
                            onSubmit={props.onInlineSubmit}
                            onCancel={props.onInlineCancel}
                        />
                    );
                }

                return (
                    <div
                        key={entry.path}
                        className={'gb-tree-group'}
                        style={{ ['--guide' as string]: `${depth * 14 + 15}px` }}
                    >
                        <Row
                            entry={entry}
                            depth={depth}
                            open={open}
                            selected={selection.has(entry.path)}
                            active={activePath === entry.path}
                            dragged={dragging?.includes(entry.path) ?? false}
                            openFile={openPaths.has(entry.path)}
                            dirty={dirtyPaths.has(entry.path)}
                            canMove={canMove}
                            canUpload={canUpload}
                            canCross={canCross}
                            paneId={props.paneId}
                            h={handlers}
                            dragging={dragging}
                            onDragging={setDragging}
                            settled={props.settled === entry.path}
                        />
                        {open && directory(entry.path, depth + 1)}
                    </div>
                );
            }),
        ];
    };

    return (
        <nav aria-label={'Server files'} className={'gb-tree'} onKeyDown={arrows}>
            <Row
                entry={null}
                depth={0}
                open
                selected={selection.has(ROOT)}
                active={false}
                dragged={false}
                openFile={false}
                dirty={false}
                canMove={canMove}
                canUpload={canUpload}
                canCross={canCross}
                paneId={props.paneId}
                h={handlers}
                dragging={dragging}
                onDragging={setDragging}
                settled={false}
            />
            {directory(ROOT, 1)}
        </nav>
    );
}
