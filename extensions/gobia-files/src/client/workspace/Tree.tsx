import { ChevronDown, ChevronRight, Ellipsis, File as FileIcon, Folder, FolderOpen } from 'lucide-react';
import { useState, type DragEvent, type ReactNode } from 'react';
import type { TreeEntry } from './api';
import type { TreeState } from './useTree';

export const MOVE_TYPE = 'application/x-gobia-file';
export const ROOT = '/';

interface TreeProps {
    tree: TreeState;
    selection: string | null;
    activePath: string | null;
    openPaths: ReadonlySet<string>;
    dirtyPaths: ReadonlySet<string>;
    canMove: boolean;
    canUpload: boolean;
    onSelect: (path: string) => void;
    onOpen: (entry: TreeEntry) => void;
    /** A right click, the menu key or the three dot button; `entry` is null for the root. */
    onMenu: (entry: TreeEntry | null, x: number, y: number) => void;
    onMove: (from: string, toDirectory: string) => void;
    onDropFiles: (data: DataTransfer, directory: string) => void;
}

interface RowProps {
    entry: TreeEntry | null;
    depth: number;
    open: boolean;
    selected: boolean;
    openFile: boolean;
    dirty: boolean;
    canMove: boolean;
    canUpload: boolean;
    onClick: () => void;
    onMenu: (x: number, y: number) => void;
    onMove: TreeProps['onMove'];
    onDropFiles: TreeProps['onDropFiles'];
    onHoverOpen: () => void;
}

function Row({
    entry,
    depth,
    open,
    selected,
    openFile,
    dirty,
    canMove,
    canUpload,
    onClick,
    onMenu,
    onMove,
    onDropFiles,
    onHoverOpen,
}: RowProps) {
    const directory = entry === null || entry.directory;
    const path = entry?.path ?? ROOT;
    const [over, setOver] = useState<'ok' | 'denied' | null>(null);
    const Chevron = open ? ChevronDown : ChevronRight;

    const dragOver = (event: DragEvent) => {
        if (!directory) return;
        const internal = event.dataTransfer.types.includes(MOVE_TYPE);
        const allowed = internal ? canMove : canUpload;
        event.preventDefault();
        event.dataTransfer.dropEffect = allowed ? (internal ? 'move' : 'copy') : 'none';
        setOver(allowed ? 'ok' : 'denied');
        if (allowed && !open) window.setTimeout(onHoverOpen, 600);
    };

    const drop = (event: DragEvent) => {
        if (!directory) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(null);
        const moved = event.dataTransfer.getData(MOVE_TYPE);
        if (moved) {
            if (canMove) onMove(moved, path);
        } else if (canUpload) {
            onDropFiles(event.dataTransfer, path);
        }
    };

    return (
        <div
            className={
                'gb-tree-row' +
                (entry === null ? ' root' : '') +
                (selected ? ' selected' : '') +
                (over === 'ok' ? ' drop-ok' : over === 'denied' ? ' drop-denied' : '')
            }
            onDragOver={dragOver}
            onDragLeave={() => setOver(null)}
            onDrop={drop}
        >
            <button
                type={'button'}
                aria-current={selected ? 'true' : undefined}
                aria-expanded={directory ? open : undefined}
                draggable={entry !== null && canMove}
                onDragStart={(event) => {
                    if (!entry) return;
                    event.dataTransfer.setData(MOVE_TYPE, entry.path);
                    event.dataTransfer.effectAllowed = 'move';
                }}
                onClick={onClick}
                onContextMenu={(event) => {
                    event.preventDefault();
                    onMenu(event.clientX, event.clientY);
                }}
                style={{ paddingLeft: depth * 14 + 8 }}
                title={path}
            >
                {directory ? (
                    <>
                        {entry ? <Chevron className={'gb-tree-chevron'} aria-hidden /> : null}
                        {open ? (
                            <FolderOpen className={'gb-tree-folder'} aria-hidden />
                        ) : (
                            <Folder className={'gb-tree-folder'} aria-hidden />
                        )}
                    </>
                ) : (
                    <>
                        <span className={'gb-tree-chevron'} />
                        <FileIcon className={'gb-tree-file'} aria-hidden />
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
                        onMenu(box.right, box.bottom);
                    }}
                >
                    <Ellipsis aria-hidden />
                </button>
            )}
        </div>
    );
}

export default function Tree(props: TreeProps) {
    const { tree, selection, activePath, openPaths, dirtyPaths, canMove, canUpload } = props;

    const directory = (path: string, depth: number): ReactNode => {
        const listing = tree.listings[path];
        const note = (text: string, error = false) => (
            <div className={'gb-tree-note' + (error ? ' error' : '')} style={{ paddingLeft: depth * 14 + 32 }}>
                {text}
            </div>
        );
        if (!listing || listing === 'loading') return note('Loading…');
        if ('error' in listing) return note(listing.error, true);
        if (listing.items.length === 0) return note('Empty');

        return listing.items.map((entry) => {
            const open = entry.directory && tree.expanded.has(entry.path);

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
                        selected={selection === entry.path || activePath === entry.path}
                        openFile={openPaths.has(entry.path)}
                        dirty={dirtyPaths.has(entry.path)}
                        canMove={canMove}
                        canUpload={canUpload}
                        onClick={() => {
                            props.onSelect(entry.path);
                            if (entry.directory) tree.toggle(entry.path);
                            else props.onOpen(entry);
                        }}
                        onMenu={(x, y) => {
                            props.onSelect(entry.path);
                            props.onMenu(entry, x, y);
                        }}
                        onMove={props.onMove}
                        onDropFiles={props.onDropFiles}
                        onHoverOpen={() => tree.expand(entry.path)}
                    />
                    {open && directory(entry.path, depth + 1)}
                </div>
            );
        });
    };

    return (
        <nav aria-label={'Server files'} className={'gb-tree'}>
            <Row
                entry={null}
                depth={0}
                open
                selected={selection === ROOT}
                openFile={false}
                dirty={false}
                canMove={false}
                canUpload={canUpload}
                onClick={() => props.onSelect(ROOT)}
                onMenu={(x, y) => {
                    props.onSelect(ROOT);
                    props.onMenu(null, x, y);
                }}
                onMove={props.onMove}
                onDropFiles={props.onDropFiles}
                onHoverOpen={() => undefined}
            />
            {directory(ROOT, 1)}
        </nav>
    );
}
