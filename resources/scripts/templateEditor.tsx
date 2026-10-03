import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
    ChevronDown,
    ChevronRight,
    Download,
    File as FileIcon,
    FilePlus,
    Folder,
    FolderOpen,
    FolderPlus,
    Pencil,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import type { EditorHandle } from '@/components/server/files/workspace/MonacoEditor';
import { languageForFile } from '@/components/server/files/workspace/languages';
import {
    blockingErrors,
    describeBlocking,
    Diagnostic,
    validateContent,
} from '@/components/server/files/workspace/validation';
import TemplateSftp from '@/components/template/TemplateSftp';

// Entry point for the admin template pages (Files and SFTP tabs). The Files tab works on the template's working
// tree: edits and uploads are not part of any revision until "Publish changes" is pressed. Monaco is a separate chunk
// that is only fetched once a text file is opened.
const MonacoEditor = lazy(
    () => import(/* webpackChunkName: "monaco-editor" */ '@/components/server/files/workspace/MonacoEditor')
);

interface Urls {
    list: string;
    read: string;
    write: string;
    upload: string;
    folder: string;
    move: string;
    download: string;
    publish: string;
    remove: string;
    csrf: string;
}

interface Entry {
    path: string;
    size: number;
    type: 'file' | 'directory';
    modified: number;
}

interface Status {
    dirty: boolean;
    added: number;
    modified: number;
    deleted: number;
    revision: number;
}

interface Upload {
    id: number;
    name: string;
    path: string;
    loaded: number;
    total: number;
    state: 'running' | 'done' | 'failed' | 'cancelled';
    error?: string;
    xhr?: XMLHttpRequest;
}

const headers = (csrf: string): Record<string, string> => ({
    Accept: 'application/json',
    'X-CSRF-TOKEN': csrf,
    'X-Requested-With': 'XMLHttpRequest',
});

const request = async (url: string, csrf: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { ...headers(csrf), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message =
            data?.errors?.[0]?.detail ||
            (data?.errors && Object.values<string[]>(data.errors)[0]?.[0]) ||
            data?.message;
        throw new Error(message || 'The request failed.');
    }

    return data;
};

const bytes = (n: number) => {
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let i = 0;
    let value = n;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }

    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
};

const baseName = (p: string) => p.split('/').pop() || p;
const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

interface MenuState {
    x: number;
    y: number;
    entry: Entry | null;
}

const TemplateFiles = ({ urls }: { urls: Urls }) => {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [status, setStatus] = useState<Status | null>(null);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [open, setOpen] = useState<{
        path: string;
        content: string;
        revision: number;
        binary: boolean;
        size: number;
    } | null>(null);
    const [dirty, setDirty] = useState(false);
    const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
    const [problems, setProblems] = useState<Diagnostic[]>([]);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const [dropActive, setDropActive] = useState(false);
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [publishing, setPublishing] = useState(false);
    const editor = useRef<EditorHandle>(null);
    const picker = useRef<HTMLInputElement>(null);
    const uploadTarget = useRef('');
    const counter = useRef(0);

    const load = useCallback(
        () =>
            request(urls.list, urls.csrf)
                .then((r) => {
                    setEntries(r.data);
                    setStatus(r.status);
                })
                .catch((e) => setMessage({ kind: 'error', text: e.message })),
        [urls]
    );
    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!menu) return;
        const close = () => setMenu(null);
        window.addEventListener('click', close);
        window.addEventListener('keydown', close);
        window.addEventListener('resize', close);

        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('keydown', close);
            window.removeEventListener('resize', close);
        };
    }, [menu]);

    const fail = (e: unknown) => setMessage({ kind: 'error', text: (e as Error).message });

    const select = async (path: string) => {
        if (dirty && !window.confirm('Discard unsaved changes to ' + open?.path + '?')) return;
        try {
            const r = await request(`${urls.read}?path=${encodeURIComponent(path)}`, urls.csrf);
            setOpen({
                path,
                content: r.content || '',
                binary: !!r.binary,
                size: r.size,
                revision: (open?.revision || 0) + 1,
            });
            setDirty(false);
            setProblems([]);
            setMessage(null);
        } catch (e) {
            fail(e);
        }
    };

    const save = async () => {
        if (!open || open.binary) return;
        const content = editor.current?.getContent(open.path) ?? open.content;
        const language = languageForFile(baseName(open.path));

        // Only structured configuration formats are checked, and a syntax error blocks the save.
        const result = await validateContent(language, content, open.path);
        editor.current?.setMarkers(open.path, result.diagnostics);
        setProblems(result.diagnostics);
        if (blockingErrors(result.diagnostics).length) {
            setMessage({ kind: 'error', text: describeBlocking(baseName(open.path), result) });
            const first = blockingErrors(result.diagnostics)[0];
            editor.current?.reveal(open.path, first.line, first.column);

            return;
        }

        try {
            await request(urls.write, urls.csrf, 'PUT', { path: open.path, content });
            editor.current?.markSaved(open.path);
            setDirty(false);
            setMessage({
                kind: 'success',
                text: `Saved ${open.path}. Publish the changes to include it in a revision.`,
            });
            load();
        } catch (e) {
            fail(e);
        }
    };

    const create = async (kind: 'file' | 'folder', dir: string) => {
        const name = window.prompt(kind === 'file' ? 'New file name' : 'New folder name');
        if (!name) return;
        const path = join(dir, name.trim());
        try {
            if (kind === 'folder') {
                await request(urls.folder, urls.csrf, 'POST', { path });
            } else {
                await request(urls.write, urls.csrf, 'PUT', { path, content: '' });
            }
            await load();
            if (kind === 'file') select(path);
        } catch (e) {
            fail(e);
        }
    };

    const move = async (from: string, to: string) => {
        if (from === to || to.startsWith(from + '/')) return;
        try {
            await request(urls.move, urls.csrf, 'POST', { from, to });
            // A moved open file keeps its text and unsaved state; only its path changes.
            if (open && (open.path === from || open.path.startsWith(from + '/'))) {
                setOpen({ ...open, path: to + open.path.slice(from.length) });
            }
            await load();
        } catch (e) {
            fail(e);
        }
    };

    const rename = async (entry: Entry) => {
        const name = window.prompt('New name', baseName(entry.path));
        if (!name || name === baseName(entry.path)) return;
        await move(entry.path, join(parentOf(entry.path), name.trim()));
    };

    const remove = async (entry: Entry) => {
        if (!window.confirm(`Remove ${entry.path}${entry.type === 'directory' ? ' and everything in it' : ''}?`))
            return;
        try {
            await request(urls.remove, urls.csrf, 'DELETE', { path: entry.path });
            if (open && (open.path === entry.path || open.path.startsWith(entry.path + '/'))) {
                setOpen(null);
                setDirty(false);
            }
            await load();
        } catch (e) {
            fail(e);
        }
    };

    const publish = async () => {
        setPublishing(true);
        try {
            const r = await request(urls.publish, urls.csrf, 'POST');
            setMessage({
                kind: 'success',
                text: r.created_revision
                    ? `Published as revision ${r.revision}. Existing servers are not changed.`
                    : 'Nothing to publish.',
            });
            await load();
        } catch (e) {
            fail(e);
        }
        setPublishing(false);
    };

    // ---- Uploads: the file is sent as the raw request body, so there is no PHP upload size limit and progress is real.
    const startUpload = (file: File, directory: string) => {
        const path = join(directory, file.name);
        const id = ++counter.current;
        const xhr = new XMLHttpRequest();
        const update = (patch: Partial<Upload>) =>
            setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
        setUploads((list) => [
            ...list,
            { id, name: file.name, path, loaded: 0, total: file.size, state: 'running', xhr },
        ]);

        xhr.open('PUT', `${urls.upload}?path=${encodeURIComponent(path)}`);
        Object.entries(headers(urls.csrf)).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => update({ loaded: e.loaded, total: e.total || file.size });
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                update({ state: 'done', loaded: file.size });
                load();
            } else {
                let text = 'The upload failed.';
                try {
                    text = JSON.parse(xhr.responseText)?.errors?.[0]?.detail || text;
                } catch (e) {
                    // keep the generic message
                }
                update({ state: 'failed', error: text });
            }
        };
        xhr.onerror = () => update({ state: 'failed', error: 'The connection was lost.' });
        xhr.onabort = () => update({ state: 'cancelled' });
        xhr.send(file);
    };

    // Directories dropped from the desktop are walked with the (widely supported) entries API.
    const collect = async (items: DataTransferItemList, directory: string) => {
        const files: Array<{ file: File; dir: string }> = [];
        const walk = async (entry: any, dir: string): Promise<void> => {
            if (entry.isFile) {
                const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
                files.push({ file, dir });
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                const next = join(dir, entry.name);
                // readEntries returns batches; keep reading until it is empty.
                for (;;) {
                    const batch: any[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
                    if (!batch.length) break;
                    for (const child of batch) await walk(child, next);
                }
            }
        };
        const roots = Array.from(items)
            .map((i) => (i as any).webkitGetAsEntry?.())
            .filter(Boolean);
        for (const root of roots) await walk(root, directory);

        return files;
    };

    const onDropFiles = async (e: React.DragEvent, directory: string) => {
        e.preventDefault();
        setDropActive(false);
        setOver(null);
        if (dragging) {
            return;
        }
        if (e.dataTransfer.items?.length && (e.dataTransfer.items[0] as any).webkitGetAsEntry) {
            const found = await collect(e.dataTransfer.items, directory);
            found.forEach(({ file, dir }) => startUpload(file, dir));
        } else {
            Array.from(e.dataTransfer.files).forEach((file) => startUpload(file, directory));
        }
    };

    // ---- Tree
    const visible = useMemo(
        () => entries.filter((e) => !Array.from(collapsed).some((c) => e.path.startsWith(c + '/'))),
        [entries, collapsed]
    );
    const depth = (p: string) => p.split('/').length - 1;

    const running = uploads.filter((u) => u.state === 'running').length;

    return (
        <div className={'box box-primary'}>
            <div className={'box-header with-border'}>
                <h3 className={'box-title'}>Files</h3>
                <div className={'box-tools'}>
                    {status?.dirty ? (
                        <span
                            className={'gb-badge gb-badge-warning'}
                            title={'Changes in the working files that are not in any revision'}
                        >
                            {status.added} added · {status.modified} changed · {status.deleted} removed
                        </span>
                    ) : (
                        <span className={'gb-badge gb-badge-success'}>Published as r{status?.revision}</span>
                    )}
                    <button
                        type={'button'}
                        className={'gb-btn gb-btn-sm gb-btn-primary'}
                        disabled={!status?.dirty || publishing}
                        onClick={publish}
                    >
                        Publish changes
                    </button>
                </div>
            </div>
            <div className={'box-body'}>
                <p className={'text-muted small'} style={{ marginTop: 0 }}>
                    These are the working files. Servers are created from published revisions only, and existing servers
                    are never changed. Any file type and size up to the template limits is allowed. You can also manage
                    these files over SFTP.
                </p>
                <div className={'gb-tfiles'}>
                    <div
                        className={'gb-tfiles-tree' + (dropActive ? ' drop' : '')}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, entry: null });
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (!dragging) setDropActive(true);
                        }}
                        onDragLeave={() => setDropActive(false)}
                        onDrop={(e) => {
                            if (dragging) {
                                e.preventDefault();
                                const from = dragging;
                                setDragging(null);
                                setOver(null);
                                move(from, baseName(from));

                                return;
                            }
                            onDropFiles(e, '');
                        }}
                    >
                        <div className={'gb-tfiles-toolbar'}>
                            <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => create('file', '')}>
                                <FilePlus aria-hidden /> File
                            </button>
                            <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => create('folder', '')}>
                                <FolderPlus aria-hidden /> Folder
                            </button>
                            <button
                                type={'button'}
                                className={'gb-btn gb-btn-sm'}
                                onClick={() => {
                                    uploadTarget.current = '';
                                    picker.current?.click();
                                }}
                            >
                                <Upload aria-hidden /> Upload
                            </button>
                            <input
                                ref={picker}
                                type={'file'}
                                multiple
                                hidden
                                onChange={(e) => {
                                    Array.from(e.currentTarget.files || []).forEach((f) =>
                                        startUpload(f, uploadTarget.current)
                                    );
                                    e.currentTarget.value = '';
                                }}
                            />
                        </div>
                        {entries.length === 0 && (
                            <p className={'text-muted small'} style={{ padding: 12 }}>
                                No files yet. Drop files here, or use Upload.
                            </p>
                        )}
                        <ul role={'tree'}>
                            {visible.map((entry) => {
                                const isDir = entry.type === 'directory';
                                const isCollapsed = collapsed.has(entry.path);
                                const Icon = isDir ? (isCollapsed ? Folder : FolderOpen) : FileIcon;

                                return (
                                    <li
                                        key={entry.path}
                                        role={'treeitem'}
                                        aria-expanded={isDir ? !isCollapsed : undefined}
                                        className={
                                            (open?.path === entry.path ? 'active ' : '') +
                                            (over === entry.path ? 'target ' : '') +
                                            (dragging === entry.path ? 'dragging' : '')
                                        }
                                        style={{ paddingLeft: 8 + depth(entry.path) * 16 }}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', entry.path);
                                            setDragging(entry.path);
                                        }}
                                        onDragEnd={() => {
                                            setDragging(null);
                                            setOver(null);
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (
                                                isDir &&
                                                (!dragging ||
                                                    (dragging !== entry.path && !entry.path.startsWith(dragging + '/')))
                                            ) {
                                                setOver(entry.path);
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.stopPropagation();
                                            if (dragging) {
                                                e.preventDefault();
                                                const from = dragging;
                                                setDragging(null);
                                                setOver(null);
                                                if (isDir) move(from, join(entry.path, baseName(from)));

                                                return;
                                            }
                                            onDropFiles(e, isDir ? entry.path : parentOf(entry.path));
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setMenu({ x: e.clientX, y: e.clientY, entry });
                                        }}
                                        onClick={() => {
                                            if (isDir) {
                                                setCollapsed((s) => {
                                                    const next = new Set(s);
                                                    next.has(entry.path)
                                                        ? next.delete(entry.path)
                                                        : next.add(entry.path);

                                                    return next;
                                                });
                                            } else {
                                                select(entry.path);
                                            }
                                        }}
                                    >
                                        {isDir ? (
                                            isCollapsed ? (
                                                <ChevronRight aria-hidden />
                                            ) : (
                                                <ChevronDown aria-hidden />
                                            )
                                        ) : (
                                            <span className={'gb-spacer'} />
                                        )}
                                        <Icon aria-hidden />
                                        <span className={'gb-name'}>{baseName(entry.path)}</span>
                                        {!isDir && <small>{bytes(entry.size)}</small>}
                                        <button
                                            type={'button'}
                                            className={'gb-more'}
                                            aria-label={`Actions for ${entry.path}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const box = e.currentTarget.getBoundingClientRect();
                                                setMenu({ x: box.right, y: box.bottom, entry });
                                            }}
                                        >
                                            &hellip;
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className={'gb-tfiles-editor'}>
                        {open ? (
                            <>
                                <div className={'gb-tfiles-head'}>
                                    <strong>
                                        {open.path}
                                        {dirty ? ' •' : ''}
                                    </strong>
                                    {!open.binary && (
                                        <button
                                            type={'button'}
                                            className={'gb-btn gb-btn-sm gb-btn-primary'}
                                            onClick={save}
                                        >
                                            Save
                                        </button>
                                    )}
                                </div>
                                {open.binary ? (
                                    <p className={'text-muted'} style={{ padding: 16 }}>
                                        This is a binary file ({bytes(open.size)}), so it cannot be edited here.
                                        Download it, or upload a replacement with the same name.
                                    </p>
                                ) : (
                                    <div
                                        style={{
                                            height: 440,
                                            border: '1px solid var(--gb-border-muted)',
                                            borderRadius: 10,
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <Suspense
                                            fallback={
                                                <p className={'text-muted'} style={{ padding: 12 }}>
                                                    Loading editor…
                                                </p>
                                            }
                                        >
                                            <MonacoEditor
                                                ref={editor}
                                                files={[
                                                    {
                                                        path: open.path,
                                                        language: languageForFile(baseName(open.path)),
                                                        content: open.content,
                                                        revision: open.revision,
                                                    },
                                                ]}
                                                activePath={open.path}
                                                wordWrap={false}
                                                minimap={false}
                                                readOnly={false}
                                                onDirtyChange={(_, value) => setDirty(value)}
                                                onContentChange={() => setProblems([])}
                                                onSave={save}
                                            />
                                        </Suspense>
                                    </div>
                                )}
                                {problems.length > 0 && (
                                    <ul className={'small'} style={{ marginTop: 8 }}>
                                        {problems.map((p, i) => (
                                            <li key={i}>
                                                <a
                                                    href={'#'}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        editor.current?.reveal(open.path, p.line, p.column);
                                                    }}
                                                >
                                                    Line {p.line}, column {p.column}
                                                </a>
                                                : {p.message}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        ) : (
                            <p className={'text-muted'}>
                                Select a text file to edit it. Binary files such as jars and maps are managed by
                                uploading.
                            </p>
                        )}
                        {message && (
                            <div
                                role={'status'}
                                className={'alert alert-' + (message.kind === 'error' ? 'danger' : 'success')}
                                style={{ marginTop: 10, marginBottom: 0 }}
                            >
                                {message.text}
                            </div>
                        )}
                    </div>
                </div>

                {uploads.length > 0 && (
                    <div className={'gb-uploads'}>
                        <div className={'gb-eyebrow'}>
                            Uploads {running > 0 && `(${running} running)`}
                            <button
                                type={'button'}
                                className={'gb-link'}
                                onClick={() => setUploads((l) => l.filter((u) => u.state === 'running'))}
                            >
                                Clear finished
                            </button>
                        </div>
                        {uploads.map((u) => (
                            <div key={u.id} className={'gb-upload ' + u.state}>
                                <span className={'gb-upload-name'} title={u.path}>
                                    {u.path}
                                </span>
                                <span className={'gb-upload-bar'}>
                                    <span
                                        style={{ width: `${u.total ? Math.min(100, (u.loaded / u.total) * 100) : 0}%` }}
                                    />
                                </span>
                                <small>
                                    {u.state === 'failed'
                                        ? u.error
                                        : u.state === 'done'
                                        ? 'Done'
                                        : u.state === 'cancelled'
                                        ? 'Cancelled'
                                        : `${bytes(u.loaded)} / ${bytes(u.total)}`}
                                </small>
                                {u.state === 'running' && (
                                    <button
                                        type={'button'}
                                        className={'gb-more'}
                                        aria-label={`Cancel ${u.name}`}
                                        onClick={() => u.xhr?.abort()}
                                    >
                                        <X aria-hidden />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {menu && (
                <div
                    className={'gb-menu gb-ctx'}
                    role={'menu'}
                    style={{
                        position: 'fixed',
                        left: Math.min(menu.x, window.innerWidth - 220),
                        top: Math.min(menu.y, window.innerHeight - 260),
                        zIndex: 2000,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {menu.entry && menu.entry.type === 'file' && (
                        <button
                            role={'menuitem'}
                            className={'gb-menu-item'}
                            onClick={() => {
                                setMenu(null);
                                select(menu.entry!.path);
                            }}
                        >
                            <FileIcon aria-hidden /> Open
                        </button>
                    )}
                    {menu.entry && menu.entry.type === 'directory' && (
                        <>
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    setMenu(null);
                                    create('file', menu.entry!.path);
                                }}
                            >
                                <FilePlus aria-hidden /> New file here
                            </button>
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    setMenu(null);
                                    create('folder', menu.entry!.path);
                                }}
                            >
                                <FolderPlus aria-hidden /> New folder here
                            </button>
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    uploadTarget.current = menu.entry!.path;
                                    setMenu(null);
                                    picker.current?.click();
                                }}
                            >
                                <Upload aria-hidden /> Upload here
                            </button>
                        </>
                    )}
                    {!menu.entry && (
                        <>
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    setMenu(null);
                                    create('file', '');
                                }}
                            >
                                <FilePlus aria-hidden /> New file
                            </button>
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    setMenu(null);
                                    create('folder', '');
                                }}
                            >
                                <FolderPlus aria-hidden /> New folder
                            </button>
                        </>
                    )}
                    {menu.entry && (
                        <>
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    setMenu(null);
                                    rename(menu.entry!);
                                }}
                            >
                                <Pencil aria-hidden /> Rename
                            </button>
                            {menu.entry.type === 'file' && (
                                <a
                                    role={'menuitem'}
                                    className={'gb-menu-item'}
                                    href={`${urls.download}?path=${encodeURIComponent(menu.entry.path)}`}
                                    onClick={() => setMenu(null)}
                                >
                                    <Download aria-hidden /> Download
                                </a>
                            )}
                            <div className={'gb-menu-sep'} />
                            <button
                                role={'menuitem'}
                                className={'gb-menu-item danger'}
                                onClick={() => {
                                    setMenu(null);
                                    remove(menu.entry!);
                                }}
                            >
                                <Trash2 aria-hidden /> Delete
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const mount = () => {
    const source = document.getElementById('template-file-editor');
    if (!source) return;
    const ds = source.dataset;
    const urls: Urls = {
        list: ds.listUrl || '',
        read: ds.readUrl || '',
        write: ds.writeUrl || '',
        upload: ds.uploadUrl || '',
        folder: ds.folderUrl || '',
        move: ds.moveUrl || '',
        download: ds.downloadUrl || '',
        publish: ds.publishUrl || '',
        remove: ds.deleteUrl || '',
        csrf: ds.csrf || '',
    };

    const files = document.getElementById('tab-files');
    if (files) ReactDOM.render(<TemplateFiles urls={urls} />, files);

    const sftp = document.getElementById('tab-sftp');
    if (sftp) ReactDOM.render(<TemplateSftp url={ds.sftpUrl || ''} csrf={ds.csrf || ''} />, sftp);
};
mount();
