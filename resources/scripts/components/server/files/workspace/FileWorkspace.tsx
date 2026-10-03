import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import tw from 'twin.macro';
import axios from 'axios';
import { basename, dirname, join } from 'pathe';
import { useHistory, useLocation, useParams } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faFileMedical,
    faFolderPlus,
    faPencilAlt,
    faSyncAlt,
    faTimes,
    faTrashAlt,
    faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { ServerContext } from '@/state/server';
import { usePermissions } from '@/plugins/usePermissions';
import { encodePathSegments, hashToPath } from '@/helpers';
import { httpErrorToHuman } from '@/api/http';
import loadDirectory from '@/api/server/files/loadDirectory';
import getFileContents from '@/api/server/files/getFileContents';
import saveFileContents from '@/api/server/files/saveFileContents';
import createDirectory from '@/api/server/files/createDirectory';
import renameFiles from '@/api/server/files/renameFiles';
import deleteFiles from '@/api/server/files/deleteFiles';
import getFileUploadUrl from '@/api/server/files/getFileUploadUrl';
import getFileDownloadUrl from '@/api/server/files/getFileDownloadUrl';
import PageContentBlock from '@/components/elements/PageContentBlock';
import Spinner from '@/components/elements/Spinner';
import Modal from '@/components/elements/Modal';
import Input from '@/components/elements/Input';
import { Button } from '@/components/elements/button/index';
import Tooltip from '@/components/elements/tooltip/Tooltip';
import FileTree, { Selection } from '@/components/server/files/workspace/FileTree';
import { languageForFile, LANGUAGE_LABELS, MAX_BYTES, WARN_BYTES } from '@/components/server/files/workspace/languages';
import type { EditorHandle } from '@/components/server/files/workspace/MonacoEditor';

// Monaco is large, so it is only fetched when the workspace is actually opened.
const MonacoEditor = lazy(
    () => import(/* webpackChunkName: "monaco-editor" */ '@/components/server/files/workspace/MonacoEditor')
);

type Status = 'loading' | 'ready' | 'error' | 'large' | 'toolarge' | 'binary';

interface Tab {
    path: string;
    name: string;
    language: string;
    status: Status;
    size: number;
    // The file's modified time when it was opened or last saved; used to notice changes made by others.
    mtime: number;
    content: string;
    revision: number;
    dirty: boolean;
    error?: string;
}

type Prompt = { kind: 'file' | 'folder' | 'rename'; directory: string; initial: string } | null;
type Conflict = { path: string } | null;

const MIN_HEIGHT = 480;

export default () => {
    const { action } = useParams<{ action: 'new' | 'edit' }>();
    const { hash } = useLocation();
    const history = useHistory();
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const [canCreate, canUpdate, canDelete] = usePermissions(['file.create', 'file.update', 'file.delete']);

    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [refreshToken, setRefreshToken] = useState({ directory: '/', n: 0 });
    const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
    const [prompt, setPrompt] = useState<Prompt>(null);
    const [promptValue, setPromptValue] = useState('');
    const [closing, setClosing] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<Selection | null>(null);
    const [conflict, setConflict] = useState<Conflict>(null);
    const [busy, setBusy] = useState(false);
    const [treeOpen, setTreeOpen] = useState(true);
    const [wordWrap, setWordWrap] = useState(false);
    const [minimap, setMinimap] = useState(true);
    const editor = useRef<EditorHandle>(null);
    const upload = useRef<HTMLInputElement>(null);
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    const fail = (error: unknown) =>
        setNotice({ type: 'error', message: typeof error === 'string' ? error : httpErrorToHuman(error) });
    const patch = useCallback(
        (path: string, changes: Partial<Tab>) =>
            setTabs((all) => all.map((t) => (t.path === path ? { ...t, ...changes } : t))),
        []
    );
    const refresh = (directory: string) => setRefreshToken((t) => ({ directory, n: t.n + 1 }));

    const stat = async (path: string) =>
        (await loadDirectory(uuid, dirname(path))).find((f) => f.name === basename(path));

    const readContents = async (path: string) => {
        patch(path, { status: 'loading' });
        try {
            const [content, info] = await Promise.all([getFileContents(uuid, path), stat(path)]);
            setTabs((all) =>
                all.map((t) =>
                    t.path === path
                        ? {
                              ...t,
                              status: 'ready',
                              content,
                              revision: t.revision + 1,
                              dirty: false,
                              mtime: info?.modifiedAt.getTime() ?? t.mtime,
                          }
                        : t
                )
            );
        } catch (e) {
            patch(path, { status: 'error', error: httpErrorToHuman(e) });
        }
    };

    const open = useCallback(
        async (path: string) => {
            setNotice(null);
            if (tabsRef.current.some((t) => t.path === path)) {
                setActivePath(path);

                return;
            }

            const name = basename(path);
            const base: Tab = {
                path,
                name,
                language: languageForFile(name),
                status: 'loading',
                size: 0,
                mtime: 0,
                content: '',
                revision: 0,
                dirty: false,
            };
            setTabs((all) => [...all, base]);
            setActivePath(path);

            try {
                const info = await stat(path);
                if (!info || !info.isFile)
                    return patch(path, { status: 'error', error: 'That file no longer exists.' });
                const common = { size: info.size, mtime: info.modifiedAt.getTime() };
                if (!info.isEditable()) return patch(path, { ...common, status: 'binary' });
                if (info.size > MAX_BYTES) return patch(path, { ...common, status: 'toolarge' });
                if (info.size > WARN_BYTES) return patch(path, { ...common, status: 'large' });

                patch(path, common);
                await readContents(path);
            } catch (e) {
                patch(path, { status: 'error', error: httpErrorToHuman(e) });
            }
        },
        [uuid]
    );

    // Opening the page for a file (from the file list) or for a new file in a directory.
    useEffect(() => {
        const path = hashToPath(hash);
        if (action === 'new') {
            setSelection({ path, isDirectory: true });
            setPrompt({ kind: 'file', directory: path, initial: '' });
            setPromptValue('');
        } else if (path !== '/' && path !== activePath) {
            open(path);
        }
    }, []);

    // Keep the address bar pointing at the file being edited so a reload reopens it.
    useEffect(() => {
        if (activePath && action !== 'new')
            history.replace(`/server/${id}/files/edit#${encodePathSegments(activePath)}`);
    }, [activePath]);

    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (tabsRef.current.some((t) => t.dirty)) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', warn);

        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    const dirtyPaths = useMemo(() => tabs.filter((t) => t.dirty).map((t) => t.path), [tabs]);
    const active = tabs.find((t) => t.path === activePath) || null;

    const closeNow = (path: string) => {
        setTabs((all) => {
            const index = all.findIndex((t) => t.path === path);
            const rest = all.filter((t) => t.path !== path);
            if (activePath === path) setActivePath(rest[Math.min(index, rest.length - 1)]?.path || null);

            return rest;
        });
    };

    const requestClose = (path: string) =>
        tabsRef.current.find((t) => t.path === path)?.dirty ? setClosing(path) : closeNow(path);

    const save = useCallback(
        async (path: string | null = activePath, overwrite = false) => {
            const tab = tabsRef.current.find((t) => t.path === path);
            if (!tab || tab.status !== 'ready' || !canUpdate || !editor.current) return;

            setNotice(null);
            setBusy(true);
            try {
                // Refuse to silently overwrite something that changed on the server after it was opened.
                const current = await stat(tab.path);
                if (!overwrite && current && current.modifiedAt.getTime() !== tab.mtime) {
                    setConflict({ path: tab.path });

                    return;
                }

                await saveFileContents(uuid, tab.path, editor.current.getContent(tab.path) ?? tab.content);
                editor.current.markSaved(tab.path);
                const after = await stat(tab.path);
                patch(tab.path, { mtime: after?.modifiedAt.getTime() ?? Date.now(), dirty: false });
                setNotice({ type: 'success', message: `Saved ${tab.name}.` });
            } catch (e) {
                fail(e);
            } finally {
                setBusy(false);
            }
        },
        [activePath, canUpdate, uuid]
    );

    // Ctrl/Cmd+S while focus is outside the editor (for example in the file tree).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                save();
            }
        };
        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [save]);

    const targetDirectory = selection ? (selection.isDirectory ? selection.path : dirname(selection.path)) : '/';

    const blockedByUnsaved = (path: string) =>
        tabs.find((t) => t.dirty && (t.path === path || t.path.startsWith(path + '/')));

    const submitPrompt = async () => {
        if (!prompt) return;
        const name = promptValue.trim();
        if (!name || name.includes('/') || name === '.' || name === '..')
            return fail('Names cannot be empty or contain slashes.');

        setBusy(true);
        try {
            const siblings = await loadDirectory(uuid, prompt.directory);
            if (siblings.some((f) => f.name === name)) throw 'Something with that name already exists here.';

            if (prompt.kind === 'file') {
                await saveFileContents(uuid, join(prompt.directory, name), '');
                refresh(prompt.directory);
                setPrompt(null);
                if (action === 'new')
                    history.replace(`/server/${id}/files/edit#${encodePathSegments(join(prompt.directory, name))}`);
                await open(join(prompt.directory, name));
            } else if (prompt.kind === 'folder') {
                await createDirectory(uuid, prompt.directory, name);
                refresh(prompt.directory);
                setPrompt(null);
            } else {
                const from = join(prompt.directory, prompt.initial);
                await renameFiles(uuid, prompt.directory, [{ from: prompt.initial, to: name }]);
                tabsRef.current
                    .filter((t) => t.path === from || t.path.startsWith(from + '/'))
                    .forEach((t) => closeNow(t.path));
                refresh(prompt.directory);
                setPrompt(null);
            }
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        const target = deleting;
        setDeleting(null);
        setBusy(true);
        try {
            await deleteFiles(uuid, dirname(target.path), [basename(target.path)]);
            tabsRef.current
                .filter((t) => t.path === target.path || t.path.startsWith(target.path + '/'))
                .forEach((t) => closeNow(t.path));
            setSelection(null);
            refresh(dirname(target.path));
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    const startRename = () => {
        if (!selection || selection.path === '/') return;
        const blocker = blockedByUnsaved(selection.path);
        if (blocker) return fail(`Save or close ${blocker.name} before renaming it.`);
        setPrompt({ kind: 'rename', directory: dirname(selection.path), initial: basename(selection.path) });
        setPromptValue(basename(selection.path));
    };

    const startDelete = () => {
        if (!selection || selection.path === '/') return;
        const blocker = blockedByUnsaved(selection.path);
        if (blocker) return fail(`Save or close ${blocker.name} before deleting it.`);
        setDeleting(selection);
    };

    const uploadFiles = async (files: FileList | null) => {
        if (!files || !files.length) return;
        setBusy(true);
        try {
            await Promise.all(
                Array.from(files).map(async (file) => {
                    const url = await getFileUploadUrl(uuid);
                    await axios.post(
                        url,
                        { files: file },
                        { headers: { 'Content-Type': 'multipart/form-data' }, params: { directory: targetDirectory } }
                    );
                })
            );
            refresh(targetDirectory);
            setNotice({ type: 'success', message: `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}.` });
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
            if (upload.current) upload.current.value = '';
        }
    };

    const download = async (path: string) => {
        try {
            window.open(await getFileDownloadUrl(uuid, path), '_blank', 'noopener');
        } catch (e) {
            fail(e);
        }
    };

    const reloadFromServer = async (path: string) => {
        setConflict(null);
        await readContents(path);
    };

    const toolbarButton = (label: string, icon: any, onClick: () => void, disabled = false) => (
        <Tooltip placement={'bottom'} content={label}>
            <button
                type={'button'}
                aria-label={label}
                disabled={disabled || busy}
                onClick={onClick}
                css={tw`px-2 py-1 text-sm text-neutral-300 hover:text-neutral-50 disabled:opacity-30 focus:outline-none focus:text-cyan-400`}
            >
                <FontAwesomeIcon icon={icon} fixedWidth />
            </button>
        </Tooltip>
    );

    const editorFiles = useMemo(
        () =>
            tabs
                .filter((t) => t.status === 'ready')
                .map((t) => ({ path: t.path, language: t.language, content: t.content, revision: t.revision })),
        [tabs.map((t) => `${t.path}:${t.status}:${t.revision}`).join('|')]
    );

    return (
        <PageContentBlock title={active ? active.name : 'File editor'}>
            <div css={tw`flex items-center mb-2`}>
                <h2 css={tw`text-xl text-neutral-300 flex-1`}>File editor</h2>
                <Button.Text type={'button'} onClick={() => history.push(`/server/${id}/files`)}>
                    Back to file list
                </Button.Text>
            </div>
            {notice && (
                <div
                    role={'status'}
                    css={[
                        tw`mb-2 px-3 py-2 text-sm rounded flex items-center`,
                        notice.type === 'error' ? tw`bg-red-900 text-red-100` : tw`bg-green-900 text-green-100`,
                    ]}
                >
                    <span css={tw`flex-1`}>{notice.message}</span>
                    <button type={'button'} aria-label={'Dismiss'} onClick={() => setNotice(null)}>
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
            )}
            <div
                css={tw`flex bg-neutral-900 rounded overflow-hidden shadow-lg`}
                style={{ height: `max(${MIN_HEIGHT}px, calc(100vh - 17rem))` }}
            >
                {treeOpen && (
                    <aside css={tw`w-56 sm:w-64 flex-none flex flex-col border-r border-neutral-700 bg-neutral-800`}>
                        <div css={tw`flex items-center px-1 border-b border-neutral-700`}>
                            {toolbarButton(
                                'New file',
                                faFileMedical,
                                () => {
                                    setPrompt({ kind: 'file', directory: targetDirectory, initial: '' });
                                    setPromptValue('');
                                },
                                !canCreate
                            )}
                            {toolbarButton(
                                'New folder',
                                faFolderPlus,
                                () => {
                                    setPrompt({ kind: 'folder', directory: targetDirectory, initial: '' });
                                    setPromptValue('');
                                },
                                !canCreate
                            )}
                            {toolbarButton('Upload files', faUpload, () => upload.current?.click(), !canCreate)}
                            {toolbarButton(
                                'Rename',
                                faPencilAlt,
                                startRename,
                                !selection || selection.path === '/' || !canUpdate
                            )}
                            {toolbarButton(
                                'Delete',
                                faTrashAlt,
                                startDelete,
                                !selection || selection.path === '/' || !canDelete
                            )}
                            <div css={tw`flex-1`} />
                            {toolbarButton('Refresh', faSyncAlt, () => refresh(targetDirectory))}
                            <input
                                ref={upload}
                                type={'file'}
                                multiple
                                css={tw`hidden`}
                                onChange={(e) => uploadFiles(e.currentTarget.files)}
                            />
                        </div>
                        <div css={tw`flex-1 overflow-auto py-1`}>
                            <FileTree
                                uuid={uuid}
                                selection={selection}
                                activePath={activePath}
                                openPaths={tabs.map((t) => t.path)}
                                dirtyPaths={dirtyPaths}
                                refreshToken={refreshToken}
                                onSelect={setSelection}
                                onOpen={open}
                            />
                        </div>
                    </aside>
                )}
                <section css={tw`flex-1 min-w-0 flex flex-col`}>
                    <div css={tw`flex items-stretch bg-neutral-800 border-b border-neutral-700`}>
                        <button
                            type={'button'}
                            aria-label={treeOpen ? 'Hide file explorer' : 'Show file explorer'}
                            aria-expanded={treeOpen}
                            onClick={() => setTreeOpen((v) => !v)}
                            css={tw`px-3 text-neutral-400 hover:text-neutral-100 border-r border-neutral-700 focus:outline-none focus:text-cyan-400`}
                        >
                            &#9776;
                        </button>
                        <div role={'tablist'} aria-label={'Open files'} css={tw`flex flex-1 overflow-x-auto`}>
                            {tabs.map((tab) => (
                                <div
                                    key={tab.path}
                                    role={'tab'}
                                    aria-selected={tab.path === activePath}
                                    css={[
                                        tw`flex items-center flex-none pl-3 pr-1 text-sm border-r border-neutral-700 cursor-pointer`,
                                        tab.path === activePath
                                            ? tw`bg-neutral-900 text-neutral-50`
                                            : tw`text-neutral-400 hover:text-neutral-200`,
                                    ]}
                                    title={tab.path}
                                    onClick={() => setActivePath(tab.path)}
                                    onAuxClick={(e) => e.button === 1 && requestClose(tab.path)}
                                >
                                    <button
                                        type={'button'}
                                        onClick={() => setActivePath(tab.path)}
                                        css={tw`py-2 focus:outline-none focus:underline`}
                                    >
                                        {tab.name}
                                        {tab.dirty && (
                                            <span aria-label={'unsaved changes'} css={tw`ml-1 text-cyan-400`}>
                                                &bull;
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        type={'button'}
                                        aria-label={`Close ${tab.name}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            requestClose(tab.path);
                                        }}
                                        css={tw`ml-2 px-2 py-1 rounded text-neutral-500 hover:text-neutral-100 hover:bg-neutral-700 focus:outline-none focus:text-cyan-400`}
                                    >
                                        <FontAwesomeIcon icon={faTimes} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        {active?.status === 'ready' && (
                            <div css={tw`flex items-center px-2 text-xs text-neutral-400 flex-none`}>
                                <label css={tw`mr-3 cursor-pointer hidden sm:block`}>
                                    <input
                                        type={'checkbox'}
                                        checked={wordWrap}
                                        onChange={(e) => setWordWrap(e.currentTarget.checked)}
                                        css={tw`mr-1`}
                                    />
                                    Wrap
                                </label>
                                <label css={tw`mr-3 cursor-pointer hidden sm:block`}>
                                    <input
                                        type={'checkbox'}
                                        checked={minimap}
                                        onChange={(e) => setMinimap(e.currentTarget.checked)}
                                        css={tw`mr-1`}
                                    />
                                    Minimap
                                </label>
                                <span css={tw`mr-3 hidden md:block`}>
                                    {LANGUAGE_LABELS[active.language] || active.language}
                                </span>
                                <Button
                                    type={'button'}
                                    size={'small' as any}
                                    disabled={!canUpdate || busy || !active.dirty}
                                    onClick={() => save()}
                                >
                                    Save
                                </Button>
                            </div>
                        )}
                    </div>
                    <div css={tw`flex-1 min-h-0 relative`}>
                        {tabs.length === 0 && (
                            <p
                                css={tw`absolute inset-0 flex items-center justify-center text-sm text-neutral-500 text-center px-6`}
                            >
                                Select a file in the explorer to open it. Files stay open in tabs while you browse.
                            </p>
                        )}
                        {tabs.length > 0 && (
                            <Suspense fallback={<Spinner centered size={'large'} />}>
                                <div
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        visibility: active?.status === 'ready' ? 'visible' : 'hidden',
                                    }}
                                >
                                    <MonacoEditor
                                        ref={editor}
                                        files={editorFiles}
                                        activePath={active?.status === 'ready' ? activePath : null}
                                        wordWrap={wordWrap}
                                        minimap={minimap}
                                        readOnly={!canUpdate}
                                        onDirtyChange={(path, dirty) => patch(path, { dirty })}
                                        onSave={() => save()}
                                    />
                                </div>
                            </Suspense>
                        )}
                        {active && active.status !== 'ready' && (
                            <div
                                css={tw`absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-neutral-900`}
                            >
                                {active.status === 'loading' && <Spinner size={'large'} />}
                                {active.status === 'error' && <p css={tw`text-red-400 text-sm`}>{active.error}</p>}
                                {active.status === 'binary' && (
                                    <>
                                        <p css={tw`text-sm text-neutral-300 mb-3`}>
                                            {active.name} is not a text file, so it cannot be edited here.
                                        </p>
                                        <Button type={'button'} onClick={() => download(active.path)}>
                                            Download
                                        </Button>
                                    </>
                                )}
                                {active.status === 'toolarge' && (
                                    <>
                                        <p css={tw`text-sm text-neutral-300 mb-3`}>
                                            {active.name} is {(active.size / 1048576).toFixed(1)} MB, which is too large
                                            to edit in the browser.
                                        </p>
                                        <Button type={'button'} onClick={() => download(active.path)}>
                                            Download
                                        </Button>
                                    </>
                                )}
                                {active.status === 'large' && (
                                    <>
                                        <p css={tw`text-sm text-neutral-300 mb-3`}>
                                            {active.name} is {(active.size / 1048576).toFixed(1)} MB. Opening it may
                                            make the editor slow.
                                        </p>
                                        <div css={tw`flex`}>
                                            <Button type={'button'} onClick={() => readContents(active.path)}>
                                                Open anyway
                                            </Button>
                                            <Button.Text
                                                type={'button'}
                                                css={tw`ml-2`}
                                                onClick={() => download(active.path)}
                                            >
                                                Download instead
                                            </Button.Text>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            </div>

            <Modal
                visible={!!prompt}
                onDismissed={() => setPrompt(null)}
                dismissable
                closeOnEscape
                showSpinnerOverlay={busy}
            >
                <h2 css={tw`text-xl mb-4 text-neutral-100`}>
                    {prompt?.kind === 'file' ? 'New file' : prompt?.kind === 'folder' ? 'New folder' : 'Rename'}
                </h2>
                <p css={tw`text-xs text-neutral-400 mb-2`}>
                    In {prompt?.directory === '/' ? '/home/container' : prompt?.directory}
                </p>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitPrompt();
                    }}
                >
                    <Input
                        autoFocus
                        value={promptValue}
                        onChange={(e) => setPromptValue(e.currentTarget.value)}
                        aria-label={'Name'}
                    />
                    <div css={tw`flex justify-end mt-4`}>
                        <Button.Text type={'button'} css={tw`mr-2`} onClick={() => setPrompt(null)}>
                            Cancel
                        </Button.Text>
                        <Button type={'submit'} disabled={busy || !promptValue.trim()}>
                            {prompt?.kind === 'rename' ? 'Rename' : 'Create'}
                        </Button>
                    </div>
                </form>
            </Modal>

            <Modal visible={!!closing} onDismissed={() => setClosing(null)} dismissable closeOnEscape>
                <h2 css={tw`text-xl mb-3 text-neutral-100`}>Discard unsaved changes?</h2>
                <p css={tw`text-sm text-neutral-300`}>
                    {closing && basename(closing)} has changes that have not been saved. Closing it will lose them.
                </p>
                <div css={tw`flex justify-end mt-6`}>
                    <Button.Text type={'button'} css={tw`mr-2`} onClick={() => setClosing(null)}>
                        Keep editing
                    </Button.Text>
                    <Button.Danger
                        type={'button'}
                        onClick={() => {
                            closeNow(closing!);
                            setClosing(null);
                        }}
                    >
                        Discard and close
                    </Button.Danger>
                </div>
            </Modal>

            <Modal visible={!!deleting} onDismissed={() => setDeleting(null)} dismissable closeOnEscape>
                <h2 css={tw`text-xl mb-3 text-neutral-100`}>Delete {deleting && basename(deleting.path)}?</h2>
                <p css={tw`text-sm text-neutral-300`}>
                    {deleting?.isDirectory ? 'This folder and everything inside it' : 'This file'} will be permanently
                    deleted.
                </p>
                <div css={tw`flex justify-end mt-6`}>
                    <Button.Text type={'button'} css={tw`mr-2`} onClick={() => setDeleting(null)}>
                        Cancel
                    </Button.Text>
                    <Button.Danger type={'button'} onClick={confirmDelete}>
                        Delete
                    </Button.Danger>
                </div>
            </Modal>

            <Modal visible={!!conflict} onDismissed={() => setConflict(null)} dismissable closeOnEscape>
                <h2 css={tw`text-xl mb-3 text-neutral-100`}>This file changed on the server</h2>
                <p css={tw`text-sm text-neutral-300`}>
                    {conflict && basename(conflict.path)} was modified after you opened it, possibly by another person,
                    a plugin or the game server itself. Saving now would overwrite those changes.
                </p>
                <div css={tw`flex flex-wrap justify-end mt-6`}>
                    <Button.Text type={'button'} onClick={() => setConflict(null)}>
                        Cancel
                    </Button.Text>
                    <Button.Text
                        type={'button'}
                        css={tw`ml-2`}
                        onClick={() => conflict && reloadFromServer(conflict.path)}
                    >
                        Discard mine and reload
                    </Button.Text>
                    <Button.Danger
                        type={'button'}
                        css={tw`ml-2`}
                        onClick={() => {
                            const path = conflict!.path;
                            setConflict(null);
                            save(path, true);
                        }}
                    >
                        Overwrite
                    </Button.Danger>
                </div>
            </Modal>
        </PageContentBlock>
    );
};
