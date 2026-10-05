import React, { useCallback, useEffect, useRef, useState } from 'react';
import { join } from 'pathe';
import { ChevronDown, ChevronRight, Ellipsis, File as FileIcon, Folder, FolderOpen } from 'lucide-react';
import loadDirectory, { FileObject } from '@/api/server/files/loadDirectory';
import { httpErrorToHuman } from '@/api/http';
import { DragPayload } from '@/components/server/files/fileOps';
import { beginDrag, endDrag, useDropTarget } from '@/components/server/files/dragDrop';

export interface Selection {
    path: string;
    isDirectory: boolean;
}

interface Props {
    uuid: string;
    selection: Selection | null;
    activePath: string | null;
    openPaths: string[];
    dirtyPaths: string[];
    // Changes whenever the contents of a directory may have changed (create, rename, upload...).
    refreshToken: { directory: string; n: number };
    canMove: boolean;
    canUpload: boolean;
    onSelect: (selection: Selection) => void;
    onOpen: (path: string) => void;
    // A right click, the context menu key or the three-dot button on an entry.
    onMenu: (selection: Selection, x: number, y: number) => void;
    onMoveInto: (payload: DragPayload, directory: string) => void;
    onDropFiles: (data: DataTransfer, directory: string) => void;
}

type Listing = { items: FileObject[] } | { error: string } | 'loading';

const sortEntries = (items: FileObject[]) =>
    [...items].sort((a, b) =>
        a.isFile === b.isFile ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isFile ? 1 : -1
    );

interface RowProps {
    // The directory this entry lives in, and the entry itself.
    directory: string;
    item: FileObject | null;
    path: string;
    depth: number;
    isOpen: boolean;
    isSelected: boolean;
    isActive: boolean;
    isOpenFile: boolean;
    isDirty: boolean;
    canMove: boolean;
    canUpload: boolean;
    onClick: () => void;
    onToggle: () => void;
    onMenu: (x: number, y: number) => void;
    onMoveInto: Props['onMoveInto'];
    onDropFiles: Props['onDropFiles'];
}

const TreeRow = (p: RowProps) => {
    const isDirectory = !p.item || !p.item.isFile;
    const target = useDropTarget({
        directory: p.path,
        enabled: isDirectory,
        onMove: p.onMoveInto,
        onFiles: p.onDropFiles,
        onHoverOpen: () => !p.isOpen && p.onToggle(),
    });
    const Chevron = p.isOpen ? ChevronDown : ChevronRight;

    return (
        <div
            {...(isDirectory ? target.props : {})}
            className={
                'gb-tree-row' +
                (!p.item ? ' root' : '') +
                (p.isSelected || p.isActive ? ' selected' : '') +
                (target.state === 'ok' ? ' drop-ok' : target.state === 'denied' ? ' drop-denied' : '')
            }
        >
            <button
                type={'button'}
                aria-current={p.isSelected ? 'true' : undefined}
                aria-expanded={isDirectory ? p.isOpen : undefined}
                draggable={!!p.item && p.canMove}
                onDragStart={(e) => p.item && beginDrag(e, { directory: p.directory, names: [p.item.name] })}
                onDragEnd={endDrag}
                onClick={p.onClick}
                onContextMenu={(e) => {
                    e.preventDefault();
                    p.onMenu(e.clientX, e.clientY);
                }}
                style={{ paddingLeft: p.depth * 14 + 8 }}
                title={p.path}
            >
                {isDirectory ? (
                    <>
                        {p.item ? <Chevron className={'gb-tree-chevron'} aria-hidden /> : null}
                        {p.isOpen ? (
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
                <span
                    className={
                        'gb-tree-name' +
                        (p.isOpenFile ? ' open' : '') +
                        (p.item && !p.item.isFile ? '' : p.item && !p.item.isEditable() ? ' muted' : '')
                    }
                >
                    {p.item ? p.item.name : '/home/container'}
                </span>
                {p.isDirty && (
                    <span aria-label={'unsaved changes'} className={'gb-tree-dirty'}>
                        &bull;
                    </span>
                )}
            </button>
            {p.item && (
                <button
                    type={'button'}
                    className={'gb-tree-more'}
                    aria-label={`Actions for ${p.item.name}`}
                    aria-haspopup={'menu'}
                    onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        p.onMenu(r.right, r.bottom);
                    }}
                >
                    <Ellipsis aria-hidden />
                </button>
            )}
        </div>
    );
};

export default ({
    uuid,
    selection,
    activePath,
    openPaths,
    dirtyPaths,
    refreshToken,
    canMove,
    canUpload,
    onSelect,
    onOpen,
    onMenu,
    onMoveInto,
    onDropFiles,
}: Props) => {
    const [listings, setListings] = useState<Record<string, Listing>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));
    const latest = useRef(listings);
    latest.current = listings;

    const load = useCallback(
        (directory: string) => {
            setListings((l) => ({
                ...l,
                [directory]: l[directory] && typeof l[directory] !== 'string' ? l[directory] : 'loading',
            }));
            loadDirectory(uuid, directory)
                .then((items) => setListings((l) => ({ ...l, [directory]: { items: sortEntries(items) } })))
                .catch((e) => setListings((l) => ({ ...l, [directory]: { error: httpErrorToHuman(e) } })));
        },
        [uuid]
    );

    useEffect(() => {
        load('/');
    }, [uuid]);

    // Reload the directory that changed, and any other directory that is on screen (a move touches two).
    useEffect(() => {
        if (refreshToken.n === 0) return;
        Object.keys(latest.current).forEach((directory) => {
            if (directory === refreshToken.directory || expanded.has(directory)) load(directory);
        });
    }, [refreshToken]);

    const toggle = (path: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
                if (!(path in latest.current)) load(path);
            }

            return next;
        });
    };

    const renderDirectory = (directory: string, depth: number): React.ReactNode => {
        const listing = listings[directory];
        const note = (text: string, error = false) => (
            <div className={'gb-tree-note' + (error ? ' error' : '')} style={{ paddingLeft: depth * 14 + 32 }}>
                {text}
            </div>
        );
        if (!listing || listing === 'loading') return note('Loading…');
        if ('error' in listing) return note(listing.error, true);
        if (listing.items.length === 0) return note('Empty');

        return listing.items.map((item) => {
            const path = join(directory, item.name);
            const isDirectory = !item.isFile;
            const isOpen = expanded.has(path);

            return (
                <div key={path} className={'gb-tree-group'} style={{ ['--guide' as string]: `${depth * 14 + 15}px` }}>
                    <TreeRow
                        directory={directory}
                        item={item}
                        path={path}
                        depth={depth}
                        isOpen={isOpen}
                        isSelected={selection?.path === path}
                        isActive={activePath === path}
                        isOpenFile={openPaths.includes(path)}
                        isDirty={dirtyPaths.includes(path)}
                        canMove={canMove}
                        canUpload={canUpload}
                        onClick={() => {
                            onSelect({ path, isDirectory });
                            if (isDirectory) toggle(path);
                            else onOpen(path);
                        }}
                        onToggle={() => toggle(path)}
                        onMenu={(x, y) => {
                            onSelect({ path, isDirectory });
                            onMenu({ path, isDirectory }, x, y);
                        }}
                        onMoveInto={onMoveInto}
                        onDropFiles={onDropFiles}
                    />
                    {isDirectory && isOpen && renderDirectory(path, depth + 1)}
                </div>
            );
        });
    };

    return (
        <nav aria-label={'Server files'} className={'gb-tree'}>
            <TreeRow
                directory={'/'}
                item={null}
                path={'/'}
                depth={0}
                isOpen
                isSelected={selection?.path === '/'}
                isActive={false}
                isOpenFile={false}
                isDirty={false}
                canMove={false}
                canUpload={canUpload}
                onClick={() => onSelect({ path: '/', isDirectory: true })}
                onToggle={() => undefined}
                onMenu={(x, y) => {
                    onSelect({ path: '/', isDirectory: true });
                    onMenu({ path: '/', isDirectory: true }, x, y);
                }}
                onMoveInto={onMoveInto}
                onDropFiles={onDropFiles}
            />
            {renderDirectory('/', 1)}
        </nav>
    );
};
