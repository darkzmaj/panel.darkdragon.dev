import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import tw from 'twin.macro';
import { basename, dirname, join } from 'pathe';
import { useHistory, useLocation, useParams } from 'react-router';
import { Actions, useStoreActions } from 'easy-peasy';
import { FontAwesomeIcon } from '@/components/elements/icons';
import {
    faBars,
    faEllipsisH,
    faFileMedical,
    faFolderPlus,
    faPencilAlt,
    faSyncAlt,
    faTimes,
    faTrashAlt,
    faUpload,
} from '@/components/elements/icons';
import { ApplicationStore } from '@/state';
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
import copyFile from '@/api/server/files/copyFile';
import getFileDownloadUrl from '@/api/server/files/getFileDownloadUrl';
import Spinner from '@/components/elements/Spinner';
import Modal from '@/components/elements/Modal';
import Input from '@/components/elements/Input';
import Popover from '@/components/elements/Popover';
import ContextMenu, { MenuItem, MenuState } from '@/components/elements/ContextMenu';
import {
    Copy,
    CopyPlus,
    Download,
    FilePlus,
    FolderInput,
    FolderPlus as FolderPlusIcon,
    FolderUp,
    Pencil,
    RefreshCw,
    Trash2,
    Upload as UploadIcon,
} from 'lucide-react';
import { copyText } from '@/components/server/files/FileDropdownMenu';
import { displayPath, remapPath } from '@/components/server/files/fileOps';
import useMoveEntries from '@/components/server/files/useMoveEntries';
import { UploadDropZone, UploadPanel, uploadDropped, uploadPicked } from '@/components/server/files/UploadPanel';
import { onUploadCompleted } from '@/components/server/files/uploadQueue';
import { Button } from '@/components/elements/button/index';
import FileTree, { Selection } from '@/components/server/files/workspace/FileTree';
import { languageForFile, LANGUAGE_LABELS, MAX_BYTES, WARN_BYTES } from '@/components/server/files/workspace/languages';
import {
    blockingErrors,
    describeBlocking,
    Diagnostic,
    validateContent,
} from '@/components/server/files/workspace/validation';
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
    // The file's modified time when it was opened or last saved; used to notice changes made by someone else.
    mtime: number;
    content: string;
    revision: number;
    dirty: boolean;
    error?: string;
}

type Prompt = { kind: 'file' | 'folder' | 'rename' | 'move'; directory: string; initial: string } | null;
type Conflict = {
    path: string;
    remoteMtime?: number;
    remoteSize?: number;
    compare: boolean;
    arming: boolean;
    confirmed: boolean;
} | null;

const WIDTH_KEY = 'gobia:explorer-width';
const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 480;
const MOBILE = 768;

// Height of the workspace: whatever is left of the viewport below its own top edge, so it adapts to the header,
// server navigation and any banner above it instead of relying on a fixed offset.
const useRemainingHeight = (ref: React.RefObject<HTMLElement>) => {
    const [height, setHeight] = useState(560);

    useLayoutEffect(() => {
        const measure = () => {
            const top = ref.current?.getBoundingClientRect().top ?? 0;
            const viewport = window.visualViewport?.height ?? window.innerHeight;
            setHeight(Math.max(360, Math.floor(viewport - Math.max(0, top) - 12)));
        };
        measure();
        window.addEventListener('resize', measure);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(document.body);

        return () => {
            window.removeEventListener('resize', measure);
            observer?.disconnect();
        };
    }, []);

    return height;
};

const useIsMobile = () => {
    const [mobile, setMobile] = useState(window.innerWidth < MOBILE);
    useEffect(() => {
        const onResize = () => setMobile(window.innerWidth < MOBILE);
        window.addEventListener('resize', onResize);

        return () => window.removeEventListener('resize', onResize);
    }, []);

    return mobile;
};

const iconButton = tw`px-2 py-1 text-sm text-neutral-300 hover:text-neutral-50 disabled:opacity-30 focus:outline-none focus:text-cyan-400`;
const toolButton = 'gb-icon-btn gb-icon-btn-sm';

export default () => {
    const { action } = useParams<{ action: 'new' | 'edit' }>();
    const { hash } = useLocation();
    const history = useHistory();
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const [canCreate, canUpdate, canDelete] = usePermissions(['file.create', 'file.update', 'file.delete']);
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);
    const mobile = useIsMobile();

    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic[]>>({});
    const [selection, setSelection] = useState<Selection | null>(null);
    const [refreshToken, setRefreshToken] = useState({ directory: '/', n: 0 });
    const [prompt, setPrompt] = useState<Prompt>(null);
    const [promptValue, setPromptValue] = useState('');
    const [closing, setClosing] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<Selection | null>(null);
    const [conflict, setConflict] = useState<Conflict>(null);
    const [busy, setBusy] = useState(false);
    const [treeOpen, setTreeOpen] = useState(() => window.innerWidth >= MOBILE);
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        try {
            return Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, Number(localStorage.getItem(WIDTH_KEY)) || 256));
        } catch {
            return 256;
        }
    });
    const [wordWrap, setWordWrap] = useState(false);
    const [minimap, setMinimap] = useState(() => window.innerWidth >= 1100);
    const [problemsOpen, setProblemsOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const { move: moveEntries, dialog: conflictDialog } = useMoveEntries(uuid);

    const root = useRef<HTMLDivElement>(null);
    const editor = useRef<EditorHandle>(null);
    const upload = useRef<HTMLInputElement>(null);
    const uploadFolder = useRef<HTMLInputElement>(null);
    const problemsButton = useRef<HTMLButtonElement>(null);
    const moreButton = useRef<HTMLButtonElement>(null);
    const validationTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    const height = useRemainingHeight(root);

    const fail = (error: unknown) =>
        toast({ type: 'error', message: typeof error === 'string' ? error : httpErrorToHuman(error) });
    const patch = useCallback(
        (path: string, changes: Partial<Tab>) =>
            setTabs((all) => all.map((t) => (t.path === path ? { ...t, ...changes } : t))),
        []
    );
    const refresh = (directory: string) => setRefreshToken((t) => ({ directory, n: t.n + 1 }));
    const stat = async (path: string) =>
        (await loadDirectory(uuid, dirname(path))).find((f) => f.name === basename(path));

    // --- validation -------------------------------------------------------------------------------------------

    const runValidation = useCallback(async (path: string) => {
        const tab = tabsRef.current.find((t) => t.path === path);
        const content = editor.current?.getContent(path);
        if (!tab || content === undefined) return [] as Diagnostic[];

        const result = await validateContent(tab.language, content, path);
        setDiagnostics((d) => ({ ...d, [path]: result.diagnostics }));
        editor.current?.setMarkers(path, result.diagnostics);

        return result;
    }, []);

    const onContentChange = useCallback(
        (path: string) => {
            clearTimeout(validationTimers.current[path]);
            validationTimers.current[path] = setTimeout(() => runValidation(path), 350);
        },
        [runValidation]
    );

    // --- opening files ----------------------------------------------------------------------------------------

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
            if (mobile) setTreeOpen(false);
            if (tabsRef.current.some((t) => t.path === path)) {
                setActivePath(path);

                return;
            }

            const name = basename(path);
            setTabs((all) => [
                ...all,
                {
                    path,
                    name,
                    language: languageForFile(name),
                    status: 'loading',
                    size: 0,
                    mtime: 0,
                    content: '',
                    revision: 0,
                    dirty: false,
                },
            ]);
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
        [uuid, mobile]
    );

    useEffect(() => {
        const path = hashToPath(hash);
        if (action === 'new') {
            setSelection({ path, isDirectory: true });
            setPrompt({ kind: 'file', directory: path, initial: '' });
            setPromptValue('');
        } else if (path !== '/') {
            open(path);
        }
    }, []);

    useEffect(() => {
        document.title = activePath ? `${basename(activePath)} - File editor` : 'File editor';
        if (activePath && action !== 'new')
            history.replace(`/server/${id}/files/edit#${encodePathSegments(activePath)}`);
        // Keep the active tab visible in the scrolling tab strip.
        root.current
            ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
            ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activePath]);

    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (tabsRef.current.some((t) => t.dirty)) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', warn);

        return () => {
            window.removeEventListener('beforeunload', warn);
            Object.values(validationTimers.current).forEach(clearTimeout);
        };
    }, []);

    // Validate a file as soon as it is loaded, and again after a reload from the server.
    useEffect(() => {
        const active = tabs.find((t) => t.path === activePath);
        if (active?.status !== 'ready') return undefined;

        const t = setTimeout(() => runValidation(active.path), 150);

        return () => clearTimeout(t);
    }, [activePath, tabs.map((t) => `${t.path}:${t.status}:${t.revision}`).join('|')]);

    const dirtyPaths = useMemo(() => tabs.filter((t) => t.dirty).map((t) => t.path), [tabs]);
    const active = tabs.find((t) => t.path === activePath) || null;
    const problems = (activePath && diagnostics[activePath]) || [];
    const errorCount = problems.filter((p) => p.severity === 'error').length;

    // --- closing / saving -------------------------------------------------------------------------------------

    const closeNow = (path: string) => {
        setTabs((all) => {
            const index = all.findIndex((t) => t.path === path);
            const rest = all.filter((t) => t.path !== path);
            if (activePath === path) setActivePath(rest[Math.min(index, rest.length - 1)]?.path || null);

            return rest;
        });
        setDiagnostics((d) => {
            const { [path]: _removed, ...rest } = d;

            return rest;
        });
    };

    const requestClose = (path: string) =>
        tabsRef.current.find((t) => t.path === path)?.dirty ? setClosing(path) : closeNow(path);

    const save = useCallback(
        async (path: string | null = activePath, overwrite = false) => {
            const tab = tabsRef.current.find((t) => t.path === path);
            if (!tab || tab.status !== 'ready' || !canUpdate || !editor.current) return;

            setBusy(true);
            try {
                // Syntax errors in structured config files always stop the save; source code is never checked.
                const result = await validateContent(
                    tab.language,
                    editor.current.getContent(tab.path) ?? tab.content,
                    tab.path
                );
                setDiagnostics((d) => ({ ...d, [tab.path]: result.diagnostics }));
                editor.current.setMarkers(tab.path, result.diagnostics);
                const blocking = blockingErrors(result.diagnostics);
                if (blocking.length) {
                    toast({ type: 'error', message: describeBlocking(tab.name, result) });
                    if (tab.path === activePath) editor.current.reveal(tab.path, blocking[0].line, blocking[0].column);

                    return;
                }

                // Refuse to silently replace something that changed on the server after it was opened.
                const current = await stat(tab.path);
                if (!overwrite && current && current.modifiedAt.getTime() !== tab.mtime) {
                    setConflict({
                        path: tab.path,
                        remoteMtime: current.modifiedAt.getTime(),
                        remoteSize: current.size,
                        compare: false,
                        arming: false,
                        confirmed: false,
                    });

                    return;
                }

                await saveFileContents(uuid, tab.path, editor.current.getContent(tab.path) ?? tab.content);
                editor.current.markSaved(tab.path);
                const after = await stat(tab.path);
                patch(tab.path, { mtime: after?.modifiedAt.getTime() ?? Date.now(), dirty: false });
                toast({ type: 'success', message: `Saved ${tab.name}` });
            } catch (e) {
                toast({ type: 'error', message: `Save failed: ${httpErrorToHuman(e)}` });
            } finally {
                setBusy(false);
            }
        },
        [activePath, canUpdate, uuid]
    );

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

    // --- keeping open files in step with renames and moves -----------------------------------------------------

    // A renamed or moved file (or a file inside a renamed or moved folder) stays open with its text and unsaved edits.
    const followMove = (from: string, to: string) => {
        const affected = tabsRef.current.filter((t) => t.path === from || t.path.startsWith(from + '/'));
        if (!affected.length) return;

        affected.forEach((tab) => {
            const next = remapPath(tab.path, from, to);
            editor.current?.rename(tab.path, next, languageForFile(basename(next)));
            clearTimeout(validationTimers.current[tab.path]);
            delete validationTimers.current[tab.path];
        });
        setTabs((all) =>
            all.map((t) => {
                const next = remapPath(t.path, from, to);

                return next === t.path
                    ? t
                    : { ...t, path: next, name: basename(next), language: languageForFile(basename(next)) };
            })
        );
        setDiagnostics((all) =>
            Object.fromEntries(Object.entries(all).map(([path, list]) => [remapPath(path, from, to), list]))
        );
        setActivePath((current) => (current ? remapPath(current, from, to) : current));
        setSelection((current) => (current ? { ...current, path: remapPath(current.path, from, to) } : current));
        setConflict((current) => (current ? { ...current, path: remapPath(current.path, from, to) } : current));
    };

    const moveInto = async (payload: { directory: string; names: string[] }, target: string) => {
        if (!canUpdate) return;
        const outcome = await moveEntries(payload.directory, payload.names, target);
        outcome.moved.forEach((m) => followMove(m.from, m.to));
        if (outcome.moved.length) {
            refresh(payload.directory);
            refresh(target);
        }
    };

    // --- explorer actions -------------------------------------------------------------------------------------

    const targetDirectory = selection ? (selection.isDirectory ? selection.path : dirname(selection.path)) : '/';
    const blockedByUnsaved = (path: string) =>
        tabs.find((t) => t.dirty && (t.path === path || t.path.startsWith(path + '/')));

    const submitPrompt = async () => {
        if (!prompt) return;
        const name = promptValue.trim();

        if (prompt.kind === 'move') {
            if (!name.startsWith('/')) return fail('Enter the destination folder as a full path, such as /plugins.');
            setPrompt(null);
            await moveInto({ directory: prompt.directory, names: [prompt.initial] }, name);

            return;
        }

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
                await open(join(prompt.directory, name));
            } else if (prompt.kind === 'folder') {
                await createDirectory(uuid, prompt.directory, name);
                refresh(prompt.directory);
                setPrompt(null);
            } else if (prompt.kind === 'rename') {
                const from = join(prompt.directory, prompt.initial);
                await renameFiles(uuid, prompt.directory, [{ from: prompt.initial, to: name }]);
                followMove(from, join(prompt.directory, name));
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
            toast({ type: 'success', message: `Deleted ${basename(target.path)}` });
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    const startRename = (target: Selection | null = selection) => {
        if (!target || target.path === '/') return;
        setPrompt({ kind: 'rename', directory: dirname(target.path), initial: basename(target.path) });
        setPromptValue(basename(target.path));
    };

    const startMove = (target: Selection) => {
        setPrompt({ kind: 'move', directory: dirname(target.path), initial: basename(target.path) });
        setPromptValue(dirname(target.path));
    };

    const startDelete = (target: Selection | null = selection) => {
        if (!target || target.path === '/') return;
        const blocker = blockedByUnsaved(target.path);
        if (blocker) return fail(`Save or close ${blocker.name} before deleting it.`);
        setDeleting(target);
    };

    const duplicate = async (target: Selection) => {
        setBusy(true);
        try {
            await copyFile(uuid, target.path);
            refresh(dirname(target.path));
        } catch (e) {
            fail(e);
        } finally {
            setBusy(false);
        }
    };

    const directoryOf = (target: Selection) => (target.isDirectory ? target.path : dirname(target.path));

    // The one menu for the explorer: right click, the context menu key and the three-dot button all show it.
    const openMenu = (target: Selection, x: number, y: number) => {
        const items: MenuItem[] = [];
        const isRoot = target.path === '/';
        const where = directoryOf(target);

        if (!target.isDirectory) {
            items.push({ key: 'open', label: 'Open', icon: Pencil, onSelect: () => open(target.path) });
        }
        if (canCreate) {
            items.push({
                key: 'new-file',
                label: 'New file',
                icon: FilePlus,
                separator: !target.isDirectory,
                onSelect: () => {
                    setPrompt({ kind: 'file', directory: where, initial: '' });
                    setPromptValue('');
                },
            });
            items.push({
                key: 'new-folder',
                label: 'New folder',
                icon: FolderPlusIcon,
                onSelect: () => {
                    setPrompt({ kind: 'folder', directory: where, initial: '' });
                    setPromptValue('');
                },
            });
            items.push({
                key: 'upload',
                label: 'Upload files',
                icon: UploadIcon,
                onSelect: () => {
                    setSelection({ path: where, isDirectory: true });
                    upload.current?.click();
                },
            });
        }
        if (!isRoot) {
            if (canUpdate) {
                items.push({
                    key: 'rename',
                    label: 'Rename',
                    icon: Pencil,
                    separator: true,
                    onSelect: () => startRename(target),
                });
                items.push({ key: 'move', label: 'Move', icon: FolderInput, onSelect: () => startMove(target) });
            }
            if (!target.isDirectory) {
                items.push({
                    key: 'download',
                    label: 'Download',
                    icon: Download,
                    // eslint-disable-next-line @typescript-eslint/no-use-before-define
                    onSelect: () => download(target.path),
                });
                if (canCreate) {
                    items.push({
                        key: 'duplicate',
                        label: 'Duplicate',
                        icon: CopyPlus,
                        onSelect: () => duplicate(target),
                    });
                }
            }
            items.push({
                key: 'copy-path',
                label: 'Copy path',
                icon: Copy,
                onSelect: () =>
                    copyText(target.path).then((ok) =>
                        toast({
                            type: ok ? 'success' : 'error',
                            message: ok ? 'Path copied' : 'Could not copy the path',
                        })
                    ),
            });
            if (canDelete) {
                items.push({
                    key: 'delete',
                    label: 'Delete',
                    icon: Trash2,
                    danger: true,
                    separator: true,
                    onSelect: () => startDelete(target),
                });
            }
        } else {
            items.push({
                key: 'refresh',
                label: 'Refresh',
                icon: RefreshCw,
                separator: true,
                onSelect: () => refresh('/'),
            });
        }

        setMenu({ x, y, items, title: isRoot ? '/home/container' : basename(target.path) });
    };

    const pickFiles = (input: HTMLInputElement) => {
        if (!input.files?.length) return;
        if (!uploadPicked(uuid, input.files, targetDirectory)) fail('Nothing could be uploaded from that selection.');
        input.value = '';
    };

    // A finished upload refreshes the folder it landed in.
    useEffect(() => onUploadCompleted((id, directory) => id === uuid && refresh(directory)), [uuid]);

    const download = async (path: string) => {
        try {
            window.open(await getFileDownloadUrl(uuid, path), '_blank', 'noopener');
        } catch (e) {
            fail(e);
        }
    };

    // --- sidebar resizing -------------------------------------------------------------------------------------

    const startResize = (e: React.PointerEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = sidebarWidth;
        const move = (ev: PointerEvent) =>
            setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + ev.clientX - startX)));
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setSidebarWidth((w) => {
                try {
                    localStorage.setItem(WIDTH_KEY, String(w));
                } catch {
                    // The width simply isn't remembered.
                }

                return w;
            });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    // --- render -----------------------------------------------------------------------------------------------

    const editorFiles = useMemo(
        () =>
            tabs
                .filter((t) => t.status === 'ready')
                .map((t) => ({ path: t.path, language: t.language, content: t.content, revision: t.revision })),
        [tabs.map((t) => `${t.path}:${t.status}:${t.revision}`).join('|')]
    );

    const explorerButtons = (
        <div className={'gb-explorer-tools'}>
            {[
                [
                    'New file',
                    faFileMedical,
                    () => {
                        setPrompt({ kind: 'file', directory: targetDirectory, initial: '' });
                        setPromptValue('');
                    },
                    !canCreate,
                ],
                [
                    'New folder',
                    faFolderPlus,
                    () => {
                        setPrompt({ kind: 'folder', directory: targetDirectory, initial: '' });
                        setPromptValue('');
                    },
                    !canCreate,
                ],
                ['Upload files', faUpload, () => upload.current?.click(), !canCreate],
                ['Upload folder', FolderUp, () => uploadFolder.current?.click(), !canCreate],
                ['Rename', faPencilAlt, () => startRename(), !selection || selection.path === '/' || !canUpdate],
                ['Delete', faTrashAlt, () => startDelete(), !selection || selection.path === '/' || !canDelete],
            ].map(([label, icon, onClick, disabled]) => (
                <button
                    key={label as string}
                    type={'button'}
                    title={label as string}
                    aria-label={label as string}
                    disabled={(disabled as boolean) || busy}
                    onClick={onClick as () => void}
                    className={toolButton}
                >
                    <FontAwesomeIcon icon={icon as any} fixedWidth />
                </button>
            ))}
            <div css={tw`flex-1`} />
            <button
                type={'button'}
                title={'Refresh'}
                aria-label={'Refresh'}
                disabled={busy}
                onClick={() => refresh(targetDirectory)}
                className={toolButton}
            >
                <FontAwesomeIcon icon={faSyncAlt} fixedWidth />
            </button>
            <input ref={upload} type={'file'} multiple hidden onChange={(e) => pickFiles(e.currentTarget)} />
            <input
                ref={uploadFolder}
                type={'file'}
                hidden
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => pickFiles(e.currentTarget)}
            />
        </div>
    );

    const explorer = (
        <>
            {explorerButtons}
            <div
                css={tw`flex-1 overflow-auto py-1 min-h-0`}
                onKeyDown={(e) => {
                    if (e.key === 'F2' && canUpdate) {
                        e.preventDefault();
                        startRename();
                    } else if (e.key === 'Delete' && canDelete) {
                        e.preventDefault();
                        startDelete();
                    }
                }}
            >
                <FileTree
                    uuid={uuid}
                    selection={selection}
                    activePath={activePath}
                    openPaths={tabs.map((t) => t.path)}
                    dirtyPaths={dirtyPaths}
                    refreshToken={refreshToken}
                    canMove={canUpdate}
                    canUpload={canCreate}
                    onSelect={setSelection}
                    onOpen={open}
                    onMenu={openMenu}
                    onMoveInto={moveInto}
                    onDropFiles={(data, directory) => canCreate && uploadDropped(uuid, data, directory)}
                />
            </div>
        </>
    );

    const toggles = (
        <>
            <label css={tw`flex items-center cursor-pointer text-xs text-neutral-300 px-2 py-1`}>
                <input
                    type={'checkbox'}
                    checked={wordWrap}
                    onChange={(e) => setWordWrap(e.currentTarget.checked)}
                    css={tw`mr-2`}
                />
                Word wrap
            </label>
            <label css={tw`flex items-center cursor-pointer text-xs text-neutral-300 px-2 py-1`}>
                <input
                    type={'checkbox'}
                    checked={minimap}
                    onChange={(e) => setMinimap(e.currentTarget.checked)}
                    css={tw`mr-2`}
                />
                Minimap
            </label>
        </>
    );

    return (
        <div ref={root} css={tw`px-2 sm:px-4 pt-2`}>
            <div className={'gb-workspace-head'}>
                <button
                    type={'button'}
                    aria-label={treeOpen ? 'Hide file explorer' : 'Show file explorer'}
                    aria-expanded={treeOpen}
                    onClick={() => setTreeOpen((v) => !v)}
                    className={toolButton}
                >
                    <FontAwesomeIcon icon={faBars} />
                </button>
                <p className={'gb-workspace-path'} title={activePath || ''}>
                    {activePath || 'File editor'}
                </p>
                <Button.Text type={'button'} onClick={() => history.push(`/server/${id}/files`)} css={tw`flex-none`}>
                    {mobile ? 'Files' : 'Back to file list'}
                </Button.Text>
            </div>

            <div className={'gb-workspace'} style={{ height }}>
                {treeOpen && !mobile && (
                    <>
                        <aside className={'gb-explorer'} style={{ width: sidebarWidth }}>
                            {explorer}
                        </aside>
                        <div
                            role={'separator'}
                            aria-orientation={'vertical'}
                            aria-label={'Resize file explorer'}
                            tabIndex={0}
                            onPointerDown={startResize}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowLeft') setSidebarWidth((w) => Math.max(MIN_SIDEBAR, w - 16));
                                if (e.key === 'ArrowRight') setSidebarWidth((w) => Math.min(MAX_SIDEBAR, w + 16));
                            }}
                            style={{ cursor: 'col-resize' }}
                            className={'gb-resizer'}
                        />
                    </>
                )}

                <section css={tw`flex-1 min-w-0 flex flex-col`}>
                    <div
                        role={'tablist'}
                        aria-label={'Open files'}
                        className={'gb-tabs'}
                        style={{ scrollbarWidth: 'thin' }}
                    >
                        {tabs.map((tab) => (
                            <div
                                key={tab.path}
                                role={'tab'}
                                aria-selected={tab.path === activePath}
                                title={tab.path}
                                onClick={() => setActivePath(tab.path)}
                                onAuxClick={(e) => e.button === 1 && requestClose(tab.path)}
                                className={'gb-tab' + (tab.path === activePath ? ' active' : '')}
                            >
                                <button
                                    type={'button'}
                                    onClick={() => setActivePath(tab.path)}
                                    className={'gb-tab-name'}
                                >
                                    {tab.name}
                                </button>
                                {tab.dirty && (
                                    <span aria-label={'unsaved changes'} className={'gb-tree-dirty'}>
                                        &bull;
                                    </span>
                                )}
                                <button
                                    type={'button'}
                                    aria-label={`Close ${tab.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        requestClose(tab.path);
                                    }}
                                    className={'gb-tab-close'}
                                >
                                    <FontAwesomeIcon icon={faTimes} />
                                </button>
                            </div>
                        ))}
                        {tabs.length === 0 && <span css={tw`px-3 py-2 text-sm text-neutral-500`}>No files open</span>}
                    </div>

                    {active?.status === 'ready' && (
                        <div className={'gb-editor-bar'}>
                            <span css={tw`flex-1 min-w-0 truncate`}>
                                {LANGUAGE_LABELS[active.language] || active.language}
                            </span>
                            <button
                                ref={problemsButton}
                                type={'button'}
                                onClick={() => setProblemsOpen((v) => !v)}
                                aria-haspopup={'listbox'}
                                aria-expanded={problemsOpen}
                                disabled={problems.length === 0}
                                css={[
                                    tw`mr-2 px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-cyan-600`,
                                    errorCount
                                        ? tw`text-red-300`
                                        : problems.length
                                        ? tw`text-yellow-300`
                                        : tw`text-neutral-500`,
                                ]}
                            >
                                {problems.length === 0
                                    ? 'No problems'
                                    : `${
                                          errorCount
                                              ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
                                              : `${problems.length} warning${problems.length === 1 ? '' : 's'}`
                                      }`}
                            </button>
                            <Popover
                                anchor={problemsButton.current}
                                open={problemsOpen}
                                onClose={() => setProblemsOpen(false)}
                                align={'end'}
                                role={'listbox'}
                                label={'Problems'}
                                className={
                                    'w-96 max-w-[90vw] py-1 rounded bg-neutral-800 border border-neutral-700 shadow-lg'
                                }
                            >
                                {problems.map((p, i) => (
                                    <button
                                        key={i}
                                        type={'button'}
                                        role={'option'}
                                        aria-selected={false}
                                        onClick={() => {
                                            setProblemsOpen(false);
                                            editor.current?.reveal(active.path, p.line, p.column);
                                        }}
                                        className={
                                            'block w-full text-left px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none'
                                        }
                                    >
                                        <span className={p.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}>
                                            {p.severity === 'error' ? 'Error' : 'Warning'}
                                        </span>
                                        {' · '}line {p.line}, column {p.column}
                                        <span className={'block text-neutral-400'}>{p.message}</span>
                                    </button>
                                ))}
                            </Popover>
                            {!mobile && <div css={tw`flex items-center`}>{toggles}</div>}
                            {mobile && (
                                <>
                                    <button
                                        ref={moreButton}
                                        type={'button'}
                                        aria-label={'Editor options'}
                                        aria-haspopup={'menu'}
                                        aria-expanded={moreOpen}
                                        onClick={() => setMoreOpen((v) => !v)}
                                        css={[iconButton, tw`mr-1`]}
                                    >
                                        <FontAwesomeIcon icon={faEllipsisH} />
                                    </button>
                                    <Popover
                                        anchor={moreButton.current}
                                        open={moreOpen}
                                        onClose={() => setMoreOpen(false)}
                                        align={'end'}
                                        label={'Editor options'}
                                        className={'py-1 rounded bg-neutral-800 border border-neutral-700 shadow-lg'}
                                    >
                                        {toggles}
                                    </Popover>
                                </>
                            )}
                            <Button
                                type={'button'}
                                disabled={!canUpdate || busy || !active.dirty}
                                onClick={() => save()}
                                css={tw`!py-1 !px-3 !text-xs ml-1`}
                            >
                                Save
                            </Button>
                        </div>
                    )}

                    <div css={tw`flex-1 min-h-0 relative`}>
                        {tabs.length === 0 && (
                            <p
                                css={tw`absolute inset-0 flex items-center justify-center text-sm text-neutral-500 text-center px-6`}
                            >
                                {mobile
                                    ? 'Open the explorer to choose a file.'
                                    : 'Select a file in the explorer to open it. Files stay open in tabs while you browse.'}
                            </p>
                        )}
                        {tabs.length > 0 && (
                            <Suspense
                                fallback={
                                    <div css={tw`absolute inset-0 flex items-center justify-center`}>
                                        <Spinner size={'large'} />
                                    </div>
                                }
                            >
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
                                        minimap={minimap && !mobile}
                                        readOnly={!canUpdate}
                                        onDirtyChange={(path, dirty) => patch(path, { dirty })}
                                        onContentChange={onContentChange}
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

                {mobile && treeOpen && (
                    <>
                        <div className={'gb-drawer-mask'} onClick={() => setTreeOpen(false)} aria-hidden />
                        <aside className={'gb-drawer'} aria-label={'File explorer'}>
                            {explorer}
                        </aside>
                    </>
                )}
            </div>

            <Modal
                visible={!!prompt}
                onDismissed={() => setPrompt(null)}
                dismissable
                closeOnEscape
                showSpinnerOverlay={busy}
            >
                <h2 css={tw`text-xl mb-4 text-neutral-100`}>
                    {prompt?.kind === 'file'
                        ? 'New file'
                        : prompt?.kind === 'folder'
                        ? 'New folder'
                        : prompt?.kind === 'move'
                        ? `Move ${prompt.initial}`
                        : 'Rename'}
                </h2>
                <p css={tw`text-xs text-neutral-400 mb-2`}>
                    {prompt?.kind === 'move'
                        ? 'Destination folder, as a full path'
                        : `In ${displayPath(prompt?.directory || '/')}`}
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
                            {prompt?.kind === 'rename' ? 'Rename' : prompt?.kind === 'move' ? 'Move' : 'Create'}
                        </Button>
                    </div>
                </form>
            </Modal>

            <ContextMenu menu={menu} onClose={() => setMenu(null)} />
            {conflictDialog}
            <UploadDropZone uuid={uuid} directory={targetDirectory} enabled={canCreate} />
            <UploadPanel />

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
                <h2 css={tw`text-xl mb-3 text-neutral-100`}>File changed on server</h2>
                <p css={tw`text-sm text-neutral-300`}>
                    The remote version of {conflict && basename(conflict.path)} changed since this tab was opened. It
                    may have been edited by another person, a plugin or the server itself.
                </p>
                {conflict?.compare && (
                    <dl
                        css={tw`mt-4 text-xs text-neutral-300 bg-neutral-800 rounded p-3 grid grid-cols-2 gap-x-4 gap-y-1`}
                    >
                        <dt css={tw`text-neutral-500`}>Opened version</dt>
                        <dd>{new Date(tabs.find((t) => t.path === conflict.path)?.mtime || 0).toLocaleString()}</dd>
                        <dt css={tw`text-neutral-500`}>Server version</dt>
                        <dd>{conflict.remoteMtime ? new Date(conflict.remoteMtime).toLocaleString() : 'unknown'}</dd>
                        <dt css={tw`text-neutral-500`}>Server size</dt>
                        <dd>
                            {conflict.remoteSize !== undefined
                                ? `${conflict.remoteSize.toLocaleString()} bytes`
                                : 'unknown'}
                        </dd>
                        <dt css={tw`text-neutral-500`}>Your version</dt>
                        <dd>{(editor.current?.getContent(conflict.path) ?? '').length.toLocaleString()} characters</dd>
                    </dl>
                )}
                {conflict?.arming && (
                    <label css={tw`flex items-start mt-4 text-sm text-red-200 cursor-pointer`}>
                        <input
                            type={'checkbox'}
                            checked={conflict.confirmed}
                            css={tw`mt-1 mr-2`}
                            onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setConflict((c) => (c ? { ...c, confirmed: checked } : c));
                            }}
                        />
                        I understand this permanently replaces the newer version on the server.
                    </label>
                )}
                <div css={tw`flex flex-wrap justify-end mt-6`}>
                    {conflict?.arming ? (
                        <>
                            <Button.Text
                                type={'button'}
                                onClick={() => setConflict((c) => (c ? { ...c, arming: false, confirmed: false } : c))}
                            >
                                Back
                            </Button.Text>
                            <Button.Danger
                                type={'button'}
                                css={tw`ml-2`}
                                disabled={!conflict.confirmed}
                                onClick={() => {
                                    const path = conflict.path;
                                    setConflict(null);
                                    save(path, true);
                                }}
                            >
                                Overwrite remote file
                            </Button.Danger>
                        </>
                    ) : (
                        <>
                            <Button.Text type={'button'} onClick={() => setConflict(null)}>
                                Cancel
                            </Button.Text>
                            {!conflict?.compare && (
                                <Button.Text
                                    type={'button'}
                                    css={tw`ml-2`}
                                    onClick={() => setConflict((c) => (c ? { ...c, compare: true } : c))}
                                >
                                    Compare metadata
                                </Button.Text>
                            )}
                            <Button.Text
                                type={'button'}
                                css={tw`ml-2`}
                                onClick={() => {
                                    const path = conflict!.path;
                                    setConflict(null);
                                    readContents(path);
                                }}
                            >
                                Reload remote
                            </Button.Text>
                            <Button.Danger
                                type={'button'}
                                css={tw`ml-2`}
                                onClick={() => setConflict((c) => (c ? { ...c, arming: true } : c))}
                            >
                                Overwrite&hellip;
                            </Button.Danger>
                        </>
                    )}
                </div>
            </Modal>
        </div>
    );
};
