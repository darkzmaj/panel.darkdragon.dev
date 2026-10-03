import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import type { EditorHandle } from '@/components/server/files/workspace/MonacoEditor';
import { languageForFile } from '@/components/server/files/workspace/languages';
import {
    blockingErrors,
    describeBlocking,
    Diagnostic,
    validateContent,
} from '@/components/server/files/workspace/validation';

// Entry point for the admin "Files" tab of a server template. It reuses the file workspace's Monaco editor and
// the same pre-save validation, so a template cannot ship a configuration file that would not even parse.
// Monaco itself is a separate chunk that is only fetched once this tab is first shown.
const MonacoEditor = lazy(
    () => import(/* webpackChunkName: "monaco-editor" */ '@/components/server/files/workspace/MonacoEditor')
);

interface Urls {
    list: string;
    read: string;
    write: string;
    remove: string;
    csrf: string;
}

interface Entry {
    path: string;
    size: number;
}

const request = async (url: string, csrf: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': csrf,
            'X-Requested-With': 'XMLHttpRequest',
        },
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

const FileEditor = ({ urls }: { urls: Urls }) => {
    const [files, setFiles] = useState<Entry[]>([]);
    const [open, setOpen] = useState<{ path: string; content: string; revision: number } | null>(null);
    const [dirty, setDirty] = useState(false);
    const [newPath, setNewPath] = useState('');
    const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
    const [problems, setProblems] = useState<Diagnostic[]>([]);
    const editor = useRef<EditorHandle>(null);

    const load = useCallback(
        () =>
            request(urls.list, urls.csrf)
                .then((r) => setFiles(r.data))
                .catch((e) => setMessage({ kind: 'error', text: e.message })),
        [urls]
    );
    useEffect(() => {
        load();
    }, [load]);

    const select = async (path: string) => {
        if (dirty && !window.confirm('Discard unsaved changes to ' + open?.path + '?')) return;
        try {
            const r = await request(`${urls.read}?path=${encodeURIComponent(path)}`, urls.csrf);
            setOpen({ path, content: r.content, revision: (open?.revision || 0) + 1 });
            setDirty(false);
            setProblems([]);
            setMessage(null);
        } catch (e) {
            setMessage({ kind: 'error', text: (e as Error).message });
        }
    };

    const create = () => {
        const path = newPath.trim();
        if (!path) return;
        if (dirty && !window.confirm('Discard unsaved changes to ' + open?.path + '?')) return;
        setOpen({ path, content: '', revision: (open?.revision || 0) + 1 });
        setDirty(true);
        setProblems([]);
        setNewPath('');
        setMessage({ kind: 'success', text: 'New file. It is stored when you press Save.' });
    };

    const save = async () => {
        if (!open) return;
        const content = editor.current?.getContent(open.path) ?? open.content;
        const language = languageForFile(open.path.split('/').pop() || '');

        // Only structured configuration formats are checked, and a syntax error blocks the save.
        const result = await validateContent(language, content, open.path);
        editor.current?.setMarkers(open.path, result.diagnostics);
        setProblems(result.diagnostics);
        if (blockingErrors(result.diagnostics).length) {
            setMessage({ kind: 'error', text: describeBlocking(open.path.split('/').pop() || open.path, result) });
            const first = blockingErrors(result.diagnostics)[0];
            editor.current?.reveal(open.path, first.line, first.column);

            return;
        }

        try {
            const r = await request(urls.write, urls.csrf, 'PUT', { path: open.path, content });
            editor.current?.markSaved(open.path);
            setDirty(false);
            setMessage({ kind: 'success', text: `Saved ${r.path} (template revision ${r.revision}).` });
            load();
        } catch (e) {
            setMessage({ kind: 'error', text: (e as Error).message });
        }
    };

    const remove = async (path: string) => {
        if (!window.confirm(`Remove ${path} from this template?`)) return;
        try {
            await request(urls.remove, urls.csrf, 'DELETE', { path });
            if (open?.path === path) {
                setOpen(null);
                setDirty(false);
            }
            load();
        } catch (e) {
            setMessage({ kind: 'error', text: (e as Error).message });
        }
    };

    return (
        <div className={'box box-primary'}>
            <div className={'box-header with-border'}>
                <h3 className={'box-title'}>Files</h3>
                <div className={'box-tools'} style={{ maxWidth: 320 }}>
                    <p className={'small text-muted'} style={{ margin: 0 }}>
                        Deployed into new servers after installation, before the first start.
                    </p>
                </div>
            </div>
            <div className={'box-body'} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 260px', minWidth: 200, maxWidth: '100%' }}>
                    <div className={'input-group input-group-sm'} style={{ marginBottom: 8 }}>
                        <input
                            className={'form-control'}
                            placeholder={'plugins/config.yml'}
                            value={newPath}
                            onChange={(e) => setNewPath(e.currentTarget.value)}
                            onKeyDown={(e) => e.key === 'Enter' && create()}
                            aria-label={'New file path'}
                        />
                        <span className={'input-group-btn'}>
                            <button type={'button'} className={'btn btn-primary'} onClick={create}>
                                Add
                            </button>
                        </span>
                    </div>
                    {files.length === 0 && <p className={'text-muted small'}>No files yet.</p>}
                    <ul className={'list-unstyled'} style={{ margin: 0, maxHeight: 420, overflowY: 'auto' }}>
                        {files.map((file) => (
                            <li
                                key={file.path}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '4px 6px',
                                    borderRadius: 3,
                                    background: open?.path === file.path ? 'rgba(60,141,188,.18)' : undefined,
                                }}
                            >
                                <button
                                    type={'button'}
                                    className={'btn btn-link btn-sm'}
                                    style={{
                                        padding: 0,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        textAlign: 'left',
                                    }}
                                    title={file.path}
                                    onClick={() => select(file.path)}
                                >
                                    {file.path}
                                </button>
                                <button
                                    type={'button'}
                                    className={'btn btn-link btn-xs text-danger'}
                                    aria-label={`Remove ${file.path}`}
                                    onClick={() => remove(file.path)}
                                >
                                    &times;
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                    {open ? (
                        <>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 8,
                                }}
                            >
                                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {open.path}
                                    {dirty ? ' •' : ''}
                                </strong>
                                <button type={'button'} className={'btn btn-success btn-sm'} onClick={save}>
                                    Save
                                </button>
                            </div>
                            <div style={{ height: 420, border: '1px solid #3b4a56' }}>
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
                                                language: languageForFile(open.path.split('/').pop() || ''),
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
                        <p className={'text-muted'}>Select a file, or add a new one by typing its path.</p>
                    )}
                    {message && (
                        <div
                            role={'status'}
                            className={'alert alert-' + (message.kind === 'error' ? 'danger' : 'success')}
                            style={{ marginTop: 8, marginBottom: 0 }}
                        >
                            {message.text}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const source = document.getElementById('template-file-editor');
const target = document.getElementById('tab-files');
if (source && target) {
    const urls: Urls = {
        list: source.dataset.listUrl || '',
        read: source.dataset.readUrl || '',
        write: source.dataset.writeUrl || '',
        remove: source.dataset.deleteUrl || '',
        csrf: source.dataset.csrf || '',
    };
    ReactDOM.render(<FileEditor urls={urls} />, target);
}
