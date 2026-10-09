import { Button, Dialog, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import {
    Archive,
    ArchiveRestore,
    CopyPlus,
    Download,
    FilePlus,
    FolderPlus,
    FolderUp,
    Link2,
    Copy,
    MoveRight,
    Pencil,
    RefreshCw,
    Search,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
    compressEntries,
    copyEntry,
    createFolder,
    decompressEntry,
    deleteEntries,
    downloadUrl,
    modifiedAt,
    readFile,
    statFile,
    renameEntries,
    versionOf,
    writeFile,
    type TreeEntry,
} from './api';
import ContextMenu, { type MenuItem, type MenuState } from './ContextMenu';
import { MAX_EDIT_BYTES, basename, dirname, join } from './paths';
import { loadTabs, saveTabs, takePendingOpen } from './session';
import { isDirty, tabsReducer, type Tab } from './tabs';
import type { FileResult } from './search';
import SearchPanel, { type ReplaceResult } from './SearchPanel';
import FileTypeIcon from './FileTypeIcon';
import Tree, { MOVE_TYPE, ROOT, originOf, validTarget, visiblePaths, type Inline, type SelectMode } from './Tree';
import { mark } from './timing';
import UploadPanel from './UploadPanel';
import { pickedFromDrop, pickedFromInput, useUploadQueue } from './uploads';
import { useTree, type TreeSource } from './useTree';
import { formatOf, validate, type Problem } from './validation';

// CodeMirror and the language packs are only fetched once a file is actually opened.
const loadEditor = () => {
    mark('monaco-requested', true);
    return import('./CodeEditor').then((loaded) => {
        mark('monaco-chunk-loaded', true);
        return loaded;
    });
};
type EditorModule = Awaited<ReturnType<typeof loadEditor>>;
const DiffView = lazy(() => import('./DiffView'));

// Not in the DOM typings; the folder picker needs both spellings.
const DIRECTORY_PICKER = { webkitdirectory: '', directory: '' };

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 520;
const SIDEBAR_KEY = 'gobia-files:sidebar';
const WRAP_KEY = 'gobia-files:wrap';

const LANGUAGES = new Map<string, string>([
    ['properties', 'Properties'],
    ['json', 'JSON'],
    ['yml', 'YAML'],
    ['yaml', 'YAML'],
    ['toml', 'TOML'],
    ['xml', 'XML'],
    ['html', 'HTML'],
    ['css', 'CSS'],
    ['js', 'JavaScript'],
    ['mjs', 'JavaScript'],
    ['ts', 'TypeScript'],
    ['py', 'Python'],
    ['php', 'PHP'],
    ['java', 'Java'],
    ['md', 'Markdown'],
    ['sql', 'SQL'],
    ['sh', 'Shell'],
]);

const languageLabel = (name: string) =>
    LANGUAGES.get(name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '') ?? 'Plain text';

type Prompt =
    | { kind: 'invalid'; path: string; problem: Problem }
    | { kind: 'conflict'; path: string; missing: boolean; remote: string | null }
    | { kind: 'compare'; path: string; remote: string; modified: string | null }
    | { kind: 'close'; path: string }
    | { kind: 'delete'; entries: readonly TreeEntry[] };

const readStored = (key: string, fallback: number) => {
    try {
        const value = Number(window.localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
        return fallback;
    }
};

function ToolButton({
    label,
    onClick,
    disabled,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type={'button'}
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={'gb-icon-btn gb-icon-btn-sm'}
        >
            {children}
        </button>
    );
}

type SaveState = 'clean' | 'modified' | 'saving' | 'saved' | 'error' | 'conflict';
const SAVE_LABELS = {
    clean: '',
    modified: 'Modified',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    conflict: 'Conflict',
} satisfies Record<SaveState, string>;
const saveState = (tab: Tab): SaveState =>
    tab.saving
        ? 'saving'
        : tab.result === 'error'
          ? 'error'
          : tab.result === 'conflict'
            ? 'conflict'
            : isDirty(tab)
              ? 'modified'
              : tab.result === 'saved'
                ? 'saved'
                : 'clean';

interface Picked {
    paths: readonly string[];
    primary: string | null;
    anchor: string | null;
}
const NOTHING: Picked = { paths: [], primary: null, anchor: null };

export interface PaneConfig {
    uuid: string;
    /** 'a' is the server of the page (and the only pane in single mode); 'b' is the second server of dual mode. */
    paneId: 'a' | 'b';
    permissions: FilePermissions;
    treeSource: TreeSource;
    mobile: boolean;
    /** Called when a file is opened or created, so a phone's drawer can close. */
    onNavigate?: () => void;
    /** Save every open file of every pane (Ctrl+Shift+S); this pane's own files when absent. */
    onSaveAll?: () => void;
    /** The pane received focus (the editor or the explorer), so shortcuts know which one to act on. */
    onFocusPane?: () => void;
    /** The other server of the dual workspace, when there is one and this pane may send files to it. */
    peer?: { name: string; canWrite: boolean } | null;
    /** Copy or move these paths of this server to the other one (the root of it unless a folder is given). */
    onTransfer?: (paths: string[], mode: 'copy' | 'move', directory?: string) => void;
    /** Files dropped on this explorer from the other one. */
    onCrossDrop?: (origin: string, paths: string[], directory: string, copy: boolean) => void;
}

export interface FilePermissions {
    create: boolean;
    update: boolean;
    delete: boolean;
    archive: boolean;
}

export function usePane(config: PaneConfig) {
    const { uuid, permissions, mobile } = config;
    const [state, dispatch] = useReducer(tabsReducer, uuid, (id: string) => loadTabs(id, config.paneId));
    const tree = useTree(uuid, config.treeSource);
    const [prompt, setPrompt] = useState<Prompt | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    // What is selected lives here, not in CSS: every selected path, the one the keyboard and menus act on, and the
    // anchor a shift click extends from.
    const [picked, setPicked] = useState<Picked>(NOTHING);
    const selection = picked.primary;
    const selectedSet = useMemo(() => new Set(picked.paths), [picked.paths]);
    const setSelection = (path: string | null) =>
        setPicked(path === null ? NOTHING : { paths: [path], primary: path, anchor: path });
    const [inline, setInline] = useState<Inline | null>(null);
    const [explorerView, setExplorerView] = useState<'files' | 'search'>('files');
    const [settled, setSettled] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [wrap, setWrap] = useState(() => readStored(WRAP_KEY, 0) === 1);
    const [problemsOpen, setProblemsOpen] = useState(false);
    const [problem, setProblem] = useState<Problem | null>(null);
    const [reveal, setReveal] = useState<{ line: number; column: number; nonce: number } | null>(null);
    // Bumped when a tab's text is replaced from outside the editor (reload), so the editor is rebuilt for it.
    const filePicker = useRef<HTMLInputElement>(null);
    const folderPicker = useRef<HTMLInputElement>(null);
    const uploadTarget = useRef<string>(ROOT);
    // When a file's version on the server was last confirmed (load, save, periodic check), so a save can skip a second look.
    const verifiedAt = useRef(new Map<string, number>());
    // The server this pane shows right now, readable from callbacks that outlive a render.
    const live = useRef(uuid);
    live.current = uuid;
    const latest = useRef({ state, tree });
    useEffect(() => {
        latest.current = { state, tree };
    });

    useEffect(() => mark('workspace-mounted', true), []);
    useEffect(() => {
        const pending = config.paneId === 'a' ? takePendingOpen(uuid) : null;
        if (pending) void openAt(pending, 1, 1);
        // Only on arrival: later navigation inside the workspace opens files itself.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid]);
    useEffect(() => {
        if (tree.listings['/'] && tree.listings['/'] !== 'loading') mark('explorer-visible', true);
    }, [tree.listings]);
    // The editor chunk is fetched as soon as the explorer is on screen (a moment later, so evaluating it never delays
    // the first paint) and kept in state: rendering the editor never suspends, because React holds back the reveal of a
    // suspended boundary for 300 ms even when its module is already loaded.
    const [editorModule, setEditorModule] = useState<EditorModule | null>(null);
    const explorerReady = tree.listings['/'] !== undefined && tree.listings['/'] !== 'loading';
    useEffect(() => {
        if (!explorerReady) return;
        const timer = window.setTimeout(
            () =>
                void loadEditor().then((loaded) => {
                    setEditorModule(loaded);
                    // When the browser is idle, so warming Monaco never lands in the middle of a click or a drag.
                    (window.requestIdleCallback
                        ? (run: () => void) => window.requestIdleCallback(run, { timeout: 2000 })
                        : (run: () => void) => window.setTimeout(run, 200))(loaded.warmUp);
                }),
            50
        );
        return () => window.clearTimeout(timer);
    }, [explorerReady]);

    // Uploads appear in the explorer as they land; only the folders they touched are fetched again when the queue idles.
    const touched = useRef(new Set<string>());
    const insert = (directory: string, entry: TreeEntry) => {
        touched.current.add(directory);
        tree.patch(directory, (items) =>
            [...items.filter((item) => item.path !== entry.path), entry].sort((a, b) =>
                a.directory === b.directory
                    ? a.name.localeCompare(b.name, undefined, { numeric: true })
                    : a.directory
                      ? -1
                      : 1
            )
        );
    };
    const uploads = useUploadQueue(uuid, {
        onFolder: (directory, name) =>
            insert(directory, {
                name,
                path: join(directory, name),
                directory: true,
                size: 0,
                mimetype: 'inode/directory',
                modifiedAt: new Date().toISOString(),
            }),
        onFile: (directory, file) =>
            insert(directory, {
                name: file.name,
                path: join(directory, file.name),
                directory: false,
                size: file.size,
                mimetype: file.type || 'application/octet-stream',
                modifiedAt: new Date().toISOString(),
            }),
        onSettled: () => {
            const directories = [...touched.current];
            touched.current.clear();
            void tree.reload(directories);
        },
    });
    const addUploads = uploads.add;

    // Tabs belong to one server. When the page moves to another server the open tabs (and, through the editor, their
    // models) are replaced by that server's remembered ones; nothing of the old server is saved under the new one.
    const owner = useRef(uuid);
    useEffect(() => {
        if (owner.current !== uuid) {
            owner.current = uuid;
            recent.current.clear();
            dispatch({ type: 'restore', state: loadTabs(uuid, config.paneId) });
            return;
        }
        saveTabs(uuid, state, config.paneId);
    }, [uuid, state]);

    const anyDirty = state.tabs.some(isDirty);
    useEffect(() => {
        if (!anyDirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [anyDirty]);

    const active = state.tabs.find((tab) => tab.path === state.active) ?? null;
    const needsEditor = active?.status === 'ready';
    useEffect(() => {
        // A file opened before the prefetch finished: load now instead of waiting for it.
        if (needsEditor && !editorModule) void loadEditor().then(setEditorModule);
    }, [needsEditor, editorModule]);

    // The problem list of the file in front, checked a moment after typing stops.
    useEffect(() => {
        if (!active || active.status !== 'ready' || !formatOf(active.name)) {
            setProblem(null);
            return;
        }
        let stale = false;
        const timer = setTimeout(() => {
            void validate(active.name, active.content).then((result) => {
                if (!stale) setProblem(result);
            });
        }, 300);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [active?.path, active?.name, active?.content, active?.status]);
    const problems = problem ? [problem] : [];

    // Files closed a moment ago open again without a request while their version is unchanged.
    const recent = useRef(new Map<string, { content: string; version: string | null; at: number }>());

    const load = useCallback(
        async (path: string, known?: string) => {
            try {
                mark('content-request');
                // A version already known from the listing saves a second round trip.
                const [content, remote] = await Promise.all([
                    readFile(uuid, path),
                    known === undefined ? modifiedAt(uuid, path) : Promise.resolve(known),
                ]);
                mark('content-response');
                dispatch({ type: 'loaded', path, content, modifiedAt: remote });
                verifiedAt.current.set(path, Date.now());
            } catch (error) {
                dispatch({ type: 'failed', path, error: httpErrorToHuman(error as Error) });
            }
        },
        [uuid]
    );

    const openFile = useCallback(
        (entry: TreeEntry) => {
            if (entry.size > MAX_EDIT_BYTES) {
                toast.error(`${entry.name} is larger than 2 MB. Download it to edit it.`);
                return;
            }
            mark('file-clicked');
            const exists = latest.current.state.tabs.some((tab) => tab.path === entry.path);
            dispatch({ type: 'open', path: entry.path, name: entry.name });
            config.onNavigate?.();
            if (exists) return;
            const version = versionOf(entry);
            const cached = recent.current.get(entry.path);
            if (cached && cached.version === version && Date.now() - cached.at < 60_000) {
                dispatch({ type: 'loaded', path: entry.path, content: cached.content, modifiedAt: version });
            } else {
                void load(entry.path, version);
            }
        },
        [load]
    );

    // ---- saving --------------------------------------------------------------------------------------------
    // One save runs per file at a time; a save asked for meanwhile runs once more afterwards with the newest text.
    // Typing never waits: the editor keeps its model while the write is in flight, and edits made meanwhile stay
    // unsaved because only the exact text that was written is marked as saved.
    const saveSlots = useRef(new Map<string, { running: boolean; again: boolean }>());
    const versionFetches = useRef(new Map<string, Promise<void>>());
    const paneId = config.paneId;

    const textOf = (path: string, fallback: string): string => editorModule?.readText(uuid, paneId, path) ?? fallback;

    const saveOnce = async (path: string, options: { force?: boolean; overwrite?: boolean }): Promise<boolean> => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
        if (!tab || tab.status !== 'ready') return false;
        const text = textOf(path, tab.content);
        const dirty = editorModule ? editorModule.hasEdits(uuid, paneId, path) : isDirty(tab);
        if (!dirty && !options.force && !options.overwrite) return true;
        // Acknowledge at once: the button reads Saving before anything is validated or sent.
        dispatch({ type: 'saving', path, saving: true });
        mark('save-acknowledged');
        const token = editorModule?.versionToken(uuid, paneId, path) ?? null;
        try {
            if (!options.force && !options.overwrite) {
                const found = await validate(tab.name, text);
                if (found) {
                    dispatch({ type: 'saving', path, saving: false });
                    setPrompt({ kind: 'invalid', path, problem: found });
                    return false;
                }
            }
            mark('save-validated');
            await versionFetches.current.get(path);
            if (!options.overwrite) {
                const known = latest.current.state.tabs.find((candidate) => candidate.path === path)?.modifiedAt;
                // The version was checked a moment ago (load, earlier save, or the periodic check): no second look.
                if (Date.now() - (verifiedAt.current.get(path) ?? 0) > 8000) {
                    const remote = await modifiedAt(uuid, path);
                    if (remote !== known) {
                        dispatch({ type: 'saving', path, saving: false });
                        dispatch({ type: 'result', path, result: 'conflict' });
                        setPrompt({ kind: 'conflict', path, missing: remote === null, remote });
                        return false;
                    }
                }
            }
            mark('save-write-start');
            await writeFile(uuid, path, text);
            mark('save-write-end');
            if (live.current !== uuid) return true; // the pane moved to another server meanwhile; the write landed on the right one
            const clean = token === null ? true : (editorModule?.markSaved(uuid, paneId, path, token) ?? true);
            dispatch({ type: 'saved', path, content: text, modifiedAt: tab.modifiedAt, dirty: !clean });
            toast.success(`Saved ${tab.name}.`);
            mark('save-confirmed');
            // The new version is read in the background; the next save waits for it, the explorer row follows it.
            verifiedAt.current.delete(path);
            const pending = statFile(uuid, path)
                .then((entry) => {
                    if (live.current !== uuid) return;
                    dispatch({ type: 'version', path, modifiedAt: entry ? versionOf(entry) : null });
                    verifiedAt.current.set(path, Date.now());
                    if (entry) {
                        tree.patch(dirname(path), (items) =>
                            items.map((item) =>
                                item.path === path ? { ...item, size: entry.size, modifiedAt: entry.modifiedAt } : item
                            )
                        );
                    }
                })
                .catch(() => undefined)
                .finally(() => {
                    if (versionFetches.current.get(path) === pending) versionFetches.current.delete(path);
                });
            versionFetches.current.set(path, pending);
            return true;
        } catch (error) {
            dispatch({ type: 'saving', path, saving: false });
            dispatch({ type: 'result', path, result: 'error' });
            toast.error(httpErrorToHuman(error as Error));
            return false;
        }
    };

    const save = useCallback(
        async (path: string, options: { force?: boolean; overwrite?: boolean } = {}): Promise<boolean> => {
            const slot = saveSlots.current.get(path) ?? { running: false, again: false };
            saveSlots.current.set(path, slot);
            if (slot.running) {
                slot.again = true;
                return true;
            }
            slot.running = true;
            let ok = false;
            try {
                do {
                    slot.again = false;
                    // eslint-disable-next-line no-await-in-loop
                    ok = await saveOnce(path, options);
                    options = {};
                } while (slot.again && ok);
            } finally {
                slot.running = false;
            }
            return ok;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [uuid, tree, editorModule]
    );

    const saveAll = async () => {
        for (const tab of latest.current.state.tabs) {
            // eslint-disable-next-line no-await-in-loop
            if (isDirty(tab)) await save(tab.path);
        }
    };

    const reloadFromServer = async (path: string) => {
        dispatch({ type: 'open', path, name: basename(path) });
        await load(path);
    };

    /** Opens a file (reading it first when needed) and puts the cursor on a line, as a search result asks. */
    const openAt = async (path: string, line: number, column: number) => {
        const exists = latest.current.state.tabs.some((tab) => tab.path === path);
        dispatch({ type: 'open', path, name: basename(path) });
        config.onNavigate?.();
        if (!exists) await load(path);
        setReveal({ line, column, nonce: Date.now() });
    };

    /** Applies a search replacement to an open tab (left unsaved) or to the file on disk. */
    const replaceInFile = async (result: FileResult, change: (text: string) => string): Promise<ReplaceResult> => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === result.path);
        if (tab) {
            if (tab.status !== 'ready') return { ok: false, reason: 'it is still loading' };
            const before = tab.content;
            dispatch({ type: 'replace', path: tab.path, content: change(before) });
            return { ok: true, undo: async () => dispatch({ type: 'replace', path: tab.path, content: before }) };
        }
        try {
            if ((await modifiedAt(uuid, result.path)) !== result.modifiedAt) {
                return { ok: false, reason: 'it changed after the search, search again' };
            }
            const text = await readFile(uuid, result.path);
            const next = change(text);
            if (next === text) return { ok: true };
            const name = basename(result.path);
            if (formatOf(name)) {
                const [before, after] = await Promise.all([validate(name, text), validate(name, next)]);
                if (!before && after) return { ok: false, reason: `it would no longer be valid (${after.message})` };
            }
            await writeFile(uuid, result.path, next);
            const written = await modifiedAt(uuid, result.path);
            void tree.reload([dirname(result.path)]);
            return {
                ok: true,
                undo: async () => {
                    // Only a file nobody touched since the replacement is put back.
                    if ((await modifiedAt(uuid, result.path)) !== written)
                        throw new Error('it changed after the replacement');
                    await writeFile(uuid, result.path, text);
                    void tree.reload([dirname(result.path)]);
                },
            };
        } catch (error) {
            return { ok: false, reason: httpErrorToHuman(error as Error) };
        }
    };

    // A file changed by someone else (console, another panel user, a server process) while it is open. A clean tab simply
    // refreshes; one with unsaved edits asks first. "Cancel" is remembered for that remote version only.
    const dismissed = useRef<Record<string, string | null>>({});
    const tabStrip = useRef<HTMLDivElement | null>(null);
    const [tabDrag, setTabDrag] = useState<{ path: string; over: string | null; after: boolean } | null>(null);
    // The wheel scrolls the tab strip sideways (a mouse has no horizontal wheel), not only its scrollbar. A callback ref,
    // because the second pane's strip is created later, inside a portal.
    const stripCleanup = useRef<(() => void) | null>(null);
    const setStrip = useCallback((strip: HTMLDivElement | null) => {
        stripCleanup.current?.();
        stripCleanup.current = null;
        tabStrip.current = strip;
        if (!strip) return;
        const wheel = (event: WheelEvent) => {
            if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.preventDefault();
            strip.scrollLeft += event.deltaY;
        };
        strip.addEventListener('wheel', wheel, { passive: false });
        stripCleanup.current = () => strip.removeEventListener('wheel', wheel);
    }, []);
    // The active tab is always scrolled into view, also when a search result or a restored session activates it.
    useEffect(() => {
        const strip = tabStrip.current;
        const current = strip?.querySelector<HTMLElement>('.gb-tab.active');
        current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [state.active, state.tabs.length]);
    useEffect(() => {
        const check = async () => {
            const { state: current } = latest.current;
            const tab = current.tabs.find((candidate) => candidate.path === current.active);
            if (!tab || tab.status !== 'ready' || tab.saving || document.hidden) return;
            let remote: string | null;
            try {
                remote = await modifiedAt(uuid, tab.path);
            } catch {
                return;
            }
            const now = latest.current.state.tabs.find((candidate) => candidate.path === tab.path);
            if (remote === now?.modifiedAt) verifiedAt.current.set(tab.path, Date.now());
            if (!now || now.saving || remote === now.modifiedAt || dismissed.current[tab.path] === remote) return;
            if (!isDirty(now)) {
                if (remote === null) return;
                await load(tab.path);
                toast.success(`${tab.name} was updated from the server.`);
                return;
            }
            setPrompt((existing) => existing ?? { kind: 'conflict', path: tab.path, missing: remote === null, remote });
        };
        const timer = window.setInterval(() => void check(), 10_000);
        const focus = () => void check();
        window.addEventListener('focus', focus);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', focus);
        };
    }, [uuid, load]);

    const compare = async (path: string) => {
        try {
            const [remote, modified] = await Promise.all([readFile(uuid, path), modifiedAt(uuid, path)]);
            setPrompt({ kind: 'compare', path, remote, modified });
        } catch (error) {
            toast.error(httpErrorToHuman(error as Error));
        }
    };

    const requestClose = useCallback((path: string) => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
        if (tab && isDirty(tab)) {
            setPrompt({ kind: 'close', path });
            return;
        }
        if (tab?.status === 'ready') {
            recent.current.set(path, { content: tab.content, version: tab.modifiedAt, at: Date.now() });
            // Only the last few files are remembered.
            for (const key of [...recent.current.keys()].slice(0, Math.max(0, recent.current.size - 20))) {
                recent.current.delete(key);
            }
        }
        dispatch({ type: 'close', path });
    }, []);

    // ---- explorer operations: each one updates the tree at once and then confirms with the server -------------

    const guard = async (work: () => Promise<void>) => {
        setBusy(true);
        try {
            await work();
        } catch (error) {
            toast.error(httpErrorToHuman(error as Error));
        } finally {
            setBusy(false);
        }
    };

    const selectRow = (path: string, mode: SelectMode) =>
        setPicked((current) => {
            if (mode === 'toggle') {
                const has = current.paths.includes(path);
                const paths = has
                    ? current.paths.filter((item) => item !== path)
                    : [...current.paths.filter((item) => item !== ROOT), path];
                return { paths, primary: has ? (paths.at(-1) ?? null) : path, anchor: path };
            }
            if (mode === 'range' && current.anchor && current.anchor !== ROOT && path !== ROOT) {
                const order = visiblePaths(latest.current.tree);
                const a = order.indexOf(current.anchor);
                const b = order.indexOf(path);
                if (a >= 0 && b >= 0) {
                    return {
                        paths: order.slice(Math.min(a, b), Math.max(a, b) + 1),
                        primary: path,
                        anchor: current.anchor,
                    };
                }
            }
            return { paths: [path], primary: path, anchor: path };
        });

    // A selection only goes away when its entry does: a loaded folder that no longer lists a path drops it.
    useEffect(() => {
        if (picked.paths.length === 0) return;
        const kept = picked.paths.filter((path) => {
            if (path === ROOT) return true;
            const listing = tree.listings[dirname(path)];
            return (
                !listing ||
                listing === 'loading' ||
                !('items' in listing) ||
                listing.items.some((item) => item.path === path)
            );
        });
        if (kept.length === picked.paths.length) return;
        setPicked((current) => {
            const paths = current.paths.filter((path) => kept.includes(path));
            return {
                paths,
                primary: paths.includes(current.primary ?? '') ? current.primary : (paths.at(-1) ?? null),
                anchor: current.anchor,
            };
        });
    }, [tree.listings, picked.paths]);

    const selectedEntries = (): TreeEntry[] => {
        const found: TreeEntry[] = [];
        for (const listing of Object.values(tree.listings)) {
            if (listing === 'loading' || 'error' in listing) continue;
            for (const item of listing.items) if (selectedSet.has(item.path)) found.push(item);
        }
        return found;
    };

    const dragSelect = (path: string): string[] => {
        if (!selectedSet.has(path)) {
            setSelection(path);
            return [path];
        }
        // Items inside a selected folder travel with it.
        return picked.paths.filter(
            (item) => item !== ROOT && !picked.paths.some((other) => other !== item && item.startsWith(`${other}/`))
        );
    };

    const targetDirectory = (): string => {
        if (!selection || selection === ROOT) return ROOT;
        for (const listing of Object.values(tree.listings)) {
            if (listing === 'loading' || 'error' in listing) continue;
            const entry = listing.items.find((candidate) => candidate.path === selection);
            if (entry) return entry.directory ? entry.path : dirname(entry.path);
        }
        return ROOT;
    };

    const startCreate = (what: 'file' | 'folder', directory: string) => {
        tree.expand(directory);
        config.onNavigate?.();
        setInline({ kind: 'create', what, directory });
    };

    const createEntry = (what: 'file' | 'folder', directory: string, name: string) =>
        guard(async () => {
            const path = join(directory, name);
            const entry: TreeEntry = {
                name,
                path,
                directory: what === 'folder',
                size: 0,
                mimetype: what === 'folder' ? 'inode/directory' : 'text/plain',
                modifiedAt: new Date().toISOString(),
            };
            const before = latest.current.tree.listings[directory];
            const release = tree.hold();
            tree.patch(directory, (items) =>
                [...items.filter((item) => item.path !== path), entry].sort((a, b) =>
                    a.directory === b.directory
                        ? a.name.localeCompare(b.name, undefined, { numeric: true })
                        : a.directory
                          ? -1
                          : 1
                )
            );
            setSelection(path);
            setSettled(path);
            try {
                if (what === 'file') await writeFile(uuid, path, '');
                else await createFolder(uuid, directory, name);
            } catch (error) {
                tree.patch(directory, (items) => items.filter((item) => item.path !== path));
                if (before && before !== 'loading' && 'items' in before) tree.patch(directory, () => before.items);
                release();
                throw error;
            }
            release();
            void tree.reload([directory]);
            if (what === 'file') {
                dispatch({ type: 'open', path, name });
                await load(path);
            }
            // A new folder stays closed: it opens when something is put in it.
        });

    const rename = (from: string, to: string) =>
        guard(async () => {
            const release = tree.hold();
            const undo = tree.move(from, to);
            dispatch({ type: 'rename', from, to });
            setSelection(to);
            setSettled(to);
            try {
                // Relative to the root of the server, so a move into another folder is the same request as a rename.
                await renameEntries(uuid, ROOT, [{ from: from.slice(1), to: to.slice(1) }]);
            } catch (error) {
                undo();
                dispatch({ type: 'rename', from: to, to: from });
                setSelection(from);
                release();
                throw error;
            }
            release();
            tree.expand(dirname(to));
            void tree.reload([dirname(from), dirname(to)]);
        });

    const remove = (entries: readonly TreeEntry[]) =>
        guard(async () => {
            const byDirectory = new Map<string, TreeEntry[]>();
            for (const entry of entries)
                byDirectory.set(dirname(entry.path), [...(byDirectory.get(dirname(entry.path)) ?? []), entry]);
            const release = tree.hold();
            const undo = tree.remove(entries.map((entry) => entry.path));
            try {
                for (const [directory, group] of byDirectory) {
                    // eslint-disable-next-line no-await-in-loop
                    await deleteEntries(
                        uuid,
                        directory,
                        group.map((entry) => entry.name)
                    );
                }
            } catch (error) {
                undo();
                release();
                void tree.reload([...byDirectory.keys()], true);
                throw error;
            }
            release();
            // Clean tabs of deleted files close; one with unsaved work stays so nothing is lost.
            for (const tab of latest.current.state.tabs) {
                const gone = entries.some((entry) => tab.path === entry.path || tab.path.startsWith(`${entry.path}/`));
                if (gone && !isDirty(tab)) dispatch({ type: 'close', path: tab.path });
            }
            setSelection(null);
            void tree.reload([...byDirectory.keys()]);
        });

    const duplicate = (entry: TreeEntry) =>
        guard(async () => {
            await copyEntry(uuid, entry.path);
            await tree.reload([dirname(entry.path)], true);
        });

    const archive = (entry: TreeEntry) =>
        guard(async () => {
            await compressEntries(uuid, dirname(entry.path), [entry.name]);
            await tree.reload([dirname(entry.path)], true);
            toast.success(`Archived ${entry.name}.`);
        });

    const extract = (entry: TreeEntry) =>
        guard(async () => {
            await decompressEntry(uuid, dirname(entry.path), entry.name);
            await tree.reload([dirname(entry.path)], true);
            toast.success(`Extracted ${entry.name}.`);
        });

    const download = (entry: TreeEntry) =>
        guard(async () => {
            window.location.assign(await downloadUrl(uuid, entry.path));
        });

    const copyPath = async (entry: TreeEntry | null) => {
        try {
            await navigator.clipboard.writeText(entry?.path ?? ROOT);
            toast.success('Path copied.');
        } catch {
            toast.error('The path could not be copied.');
        }
    };

    const moveInto = (froms: string[], directory: string) => {
        const listing = latest.current.tree.listings[directory];
        const taken =
            listing && listing !== 'loading' && 'items' in listing
                ? new Set(listing.items.map((item) => item.name))
                : undefined;
        const movable = froms.filter((from) => {
            const valid = validTarget(from, directory, taken);
            if (!valid && taken?.has(basename(from))) toast.error(`${basename(from)} already exists in that folder.`);
            return valid;
        });
        if (movable.length === 0) return;
        if (movable.length === 1) {
            void rename(movable[0]!, join(directory, basename(movable[0]!)));
            return;
        }
        const before = picked;
        const pairs = movable.map((from) => [from, join(directory, basename(from))] as const);
        void guard(async () => {
            const release = tree.hold();
            const undos = pairs.map(([from, to]) => tree.move(from, to));
            for (const [from, to] of pairs) dispatch({ type: 'rename', from, to });
            const targets = pairs.map(([, to]) => to);
            setPicked({ paths: targets, primary: targets.at(-1) ?? null, anchor: targets[0] ?? null });
            setSettled(targets[0] ?? null);
            try {
                await renameEntries(
                    uuid,
                    ROOT,
                    pairs.map(([from, to]) => ({ from: from.slice(1), to: to.slice(1) }))
                );
            } catch (error) {
                for (const undo of undos.reverse()) undo();
                for (const [from, to] of pairs) dispatch({ type: 'rename', from: to, to: from });
                setPicked(before);
                release();
                throw error;
            }
            release();
            tree.expand(directory);
            void tree.reload([...new Set([...movable.map(dirname), directory])]);
        });
    };

    const submitInline = (name: string) => {
        const current = inline;
        setInline(null);
        if (!current) return;
        if (current.kind === 'create') void createEntry(current.what, current.directory, name);
        else void rename(current.entry.path, join(dirname(current.entry.path), name));
    };

    const uploadInto = (picked: Parameters<typeof addUploads>[1], directory: string) => {
        tree.expand(directory);
        void addUploads(directory, picked);
    };

    const dropFiles = async (data: DataTransfer, directory: string) => {
        uploadInto(await pickedFromDrop(data), directory);
    };

    const chooseFiles = (input: HTMLInputElement) => {
        if (input.files && input.files.length > 0) uploadInto(pickedFromInput(input.files), uploadTarget.current);
        input.value = '';
    };

    const openMenu = (entry: TreeEntry | null, x: number, y: number) => {
        const directory = entry ? (entry.directory ? entry.path : dirname(entry.path)) : ROOT;
        const items: MenuItem[] = [];
        if (entry && !entry.directory) {
            items.push({ key: 'open', label: 'Open', icon: Pencil, onSelect: () => openFile(entry) });
        }
        if (permissions.create) {
            items.push({
                key: 'new-file',
                label: 'New file',
                icon: FilePlus,
                onSelect: () => startCreate('file', directory),
            });
            items.push({
                key: 'new-folder',
                label: 'New folder',
                icon: FolderPlus,
                onSelect: () => startCreate('folder', directory),
            });
            items.push({
                key: 'upload',
                label: 'Upload files here',
                icon: Upload,
                onSelect: () => {
                    uploadTarget.current = directory;
                    filePicker.current?.click();
                },
            });
        }
        if (entry && permissions.update) {
            items.push({
                key: 'rename',
                label: 'Rename',
                icon: Pencil,
                onSelect: () => setInline({ kind: 'rename', entry }),
            });
        }
        if (entry && permissions.create) {
            items.push({ key: 'duplicate', label: 'Duplicate', icon: CopyPlus, onSelect: () => void duplicate(entry) });
        }
        if (entry && !entry.directory) {
            items.push({ key: 'download', label: 'Download', icon: Download, onSelect: () => void download(entry) });
        }
        if (entry && permissions.archive) {
            items.push({ key: 'archive', label: 'Archive', icon: Archive, onSelect: () => void archive(entry) });
            if (!entry.directory && /\.(zip|tar|tgz|gz|bz2|xz|rar|7z)$/i.test(entry.name)) {
                items.push({
                    key: 'extract',
                    label: 'Extract',
                    icon: ArchiveRestore,
                    onSelect: () => void extract(entry),
                });
            }
        }
        if (entry && config.peer && config.onTransfer) {
            const peer = config.peer;
            const paths = selectedSet.has(entry.path) ? dragSelect(entry.path) : [entry.path];
            const plural = paths.length > 1 ? `${paths.length} items` : entry.name;
            if (peer.canWrite) {
                items.push({
                    key: 'transfer-copy',
                    label: `Copy ${plural} to ${peer.name}`,
                    icon: Copy,
                    onSelect: () => config.onTransfer?.(paths, 'copy'),
                });
                if (permissions.delete) {
                    items.push({
                        key: 'transfer-move',
                        label: `Move ${plural} to ${peer.name}`,
                        icon: MoveRight,
                        onSelect: () => config.onTransfer?.(paths, 'move'),
                    });
                }
            }
        }
        items.push({ key: 'path', label: 'Copy path', icon: Link2, onSelect: () => void copyPath(entry) });
        if (entry && permissions.delete) {
            items.push({
                key: 'delete',
                label: 'Delete',
                icon: Trash2,
                danger: true,
                onSelect: () => setPrompt({ kind: 'delete', entries: [entry] }),
            });
        }
        setMenu({ x, y, label: entry ? `Actions for ${entry.name}` : 'Server files', items });
    };

    const selectedEntry = (): TreeEntry | null => {
        if (!selection || selection === ROOT) return null;
        for (const listing of Object.values(tree.listings)) {
            if (listing === 'loading' || 'error' in listing) continue;
            const entry = listing.items.find((candidate) => candidate.path === selection);
            if (entry) return entry;
        }
        return null;
    };

    const setWordWrap = (value: boolean) => {
        setWrap(value);
        try {
            window.localStorage.setItem(WRAP_KEY, value ? '1' : '0');
        } catch {
            // Not remembered.
        }
    };

    const openPaths = useMemo(() => new Set(state.tabs.map((tab) => tab.path)), [state.tabs]);
    const editorPaths = useMemo(() => state.tabs.map((tab) => tab.path), [state.tabs]);
    const dirtyPaths = useMemo(() => new Set(state.tabs.filter(isDirty).map((tab) => tab.path)), [state.tabs]);

    // Right click anywhere in the explorer (rows, tools, the empty part) opens the Gobia menu for the root folder, never the
    // browser's. Rows handle their own click first; text fields keep the browser menu (copy, paste).
    const rootContextMenu = (event: React.MouseEvent) => {
        if (event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        setSelection(null);
        openMenu(null, event.clientX, event.clientY);
    };

    // The empty part of the explorer is the root folder: files can be dropped or moved there.
    const [rootOver, setRootOver] = useState(false);
    const rootKind = (types: readonly string[]) => {
        const origin = originOf(types);
        const cross = origin !== null && origin !== paneId;
        return { origin, cross, internal: types.includes(MOVE_TYPE) && !cross };
    };
    const rootDragOver = (event: React.DragEvent) => {
        if ((event.target as HTMLElement).closest('.gb-tree-row')) return;
        const { cross, internal } = rootKind(event.dataTransfer.types);
        const allowed = cross
            ? permissions.create && config.onCrossDrop !== undefined
            : internal
              ? permissions.update
              : permissions.create;
        if (!allowed) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = internal || (cross && !(event.ctrlKey || event.metaKey)) ? 'move' : 'copy';
        setRootOver(true);
    };
    const rootDrop = (event: React.DragEvent) => {
        if ((event.target as HTMLElement).closest('.gb-tree-row')) return;
        setRootOver(false);
        const { origin, cross, internal } = rootKind(event.dataTransfer.types);
        const moved = event.dataTransfer.getData(MOVE_TYPE);
        event.preventDefault();
        if (cross && origin && moved) {
            if (permissions.create)
                config.onCrossDrop?.(origin, JSON.parse(moved) as string[], ROOT, event.ctrlKey || event.metaKey);
        } else if (internal && moved) {
            if (permissions.update) moveInto(JSON.parse(moved) as string[], ROOT);
        } else if (permissions.create) {
            void dropFiles(event.dataTransfer, ROOT);
        }
    };

    const searching = explorerView === 'search';
    const pane = (shown: boolean): React.CSSProperties => ({
        display: shown ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
    });
    const explorer = (
        <>
            <div style={pane(searching)} onContextMenu={rootContextMenu}>
                <div className={'gb-explorer-tools'}>
                    <ToolButton label={'Back to files'} onClick={() => setExplorerView('files')}>
                        <X aria-hidden />
                    </ToolButton>
                    <span className={'gb-eyebrow'} style={{ alignSelf: 'center', marginLeft: 6 }}>
                        Search
                    </span>
                </div>
                <SearchPanel
                    uuid={uuid}
                    buffers={() =>
                        new Map(
                            latest.current.state.tabs
                                .filter((tab) => tab.status === 'ready')
                                .map((tab) => [tab.path, tab.content])
                        )
                    }
                    canReplace={permissions.update}
                    onOpen={(path, line, column) => void openAt(path, line, column)}
                    onReplace={replaceInFile}
                />
            </div>
            <div style={pane(!searching)} onContextMenu={rootContextMenu}>
                <div className={'gb-explorer-tools'}>
                    {permissions.create && (
                        <>
                            <ToolButton
                                label={'New file'}
                                disabled={busy}
                                onClick={() => startCreate('file', targetDirectory())}
                            >
                                <FilePlus aria-hidden />
                            </ToolButton>
                            <ToolButton
                                label={'New folder'}
                                disabled={busy}
                                onClick={() => startCreate('folder', targetDirectory())}
                            >
                                <FolderPlus aria-hidden />
                            </ToolButton>
                            <ToolButton
                                label={'Upload files'}
                                disabled={busy}
                                onClick={() => {
                                    uploadTarget.current = targetDirectory();
                                    filePicker.current?.click();
                                }}
                            >
                                <Upload aria-hidden />
                            </ToolButton>
                            <ToolButton
                                label={'Upload folder'}
                                disabled={busy}
                                onClick={() => {
                                    uploadTarget.current = targetDirectory();
                                    folderPicker.current?.click();
                                }}
                            >
                                <FolderUp aria-hidden />
                            </ToolButton>
                        </>
                    )}
                    <ToolButton label={'Search all files'} onClick={() => setExplorerView('search')}>
                        <Search aria-hidden />
                    </ToolButton>
                    <ToolButton
                        label={'Refresh'}
                        disabled={busy}
                        onClick={() => void tree.reload([...tree.expanded], true)}
                    >
                        <RefreshCw aria-hidden />
                    </ToolButton>
                    <input
                        ref={filePicker}
                        type={'file'}
                        multiple
                        hidden
                        onChange={(event) => chooseFiles(event.currentTarget)}
                    />
                    <input
                        ref={folderPicker}
                        type={'file'}
                        hidden
                        {...DIRECTORY_PICKER}
                        onChange={(event) => chooseFiles(event.currentTarget)}
                    />
                </div>
                <div
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        padding: '4px 0',
                        minHeight: 0,
                        boxShadow: rootOver ? 'inset 0 0 0 2px rgb(var(--p-500) / 0.6)' : undefined,
                    }}
                    onDragOver={rootDragOver}
                    onDragLeave={() => setRootOver(false)}
                    onDrop={rootDrop}
                    onClick={(event) => {
                        // The empty part of the explorer clears the selection.
                        const target = event.target as HTMLElement;
                        if (target === event.currentTarget || target.classList.contains('gb-tree')) setSelection(null);
                    }}
                    onKeyDown={(event) => {
                        const entry = selectedEntry();
                        if (!entry) return;
                        if (event.key === 'F2' && permissions.update) {
                            event.preventDefault();
                            setInline({ kind: 'rename', entry });
                        } else if (event.key === 'Delete' && permissions.delete) {
                            event.preventDefault();
                            const entries = selectedEntries();
                            setPrompt({ kind: 'delete', entries: entries.length > 0 ? entries : [entry] });
                        }
                    }}
                >
                    <Tree
                        tree={tree}
                        selection={selectedSet}
                        activePath={state.active}
                        openPaths={openPaths}
                        dirtyPaths={dirtyPaths}
                        canMove={permissions.update}
                        canUpload={permissions.create}
                        paneId={paneId}
                        onCrossDrop={config.onCrossDrop}
                        onSelect={selectRow}
                        onClear={() => setSelection(null)}
                        onDragSelect={dragSelect}
                        onOpen={openFile}
                        onMenu={openMenu}
                        onMove={moveInto}
                        onDropFiles={(data, directory) => void dropFiles(data, directory)}
                        inline={inline}
                        onInlineSubmit={submitInline}
                        onInlineCancel={() => setInline(null)}
                        settled={settled}
                    />
                </div>
            </div>
        </>
    );

    const target = prompt && 'path' in prompt ? state.tabs.find((tab) => tab.path === prompt.path) : undefined;

    const editor = (
        <>
            <div
                ref={setStrip}
                role={'group'}
                aria-label={'Open files'}
                className={'gb-tabs'}
                style={{ scrollbarWidth: 'thin' }}
            >
                {state.tabs.map((tab) => (
                    <div
                        key={tab.path}
                        title={tab.path}
                        onClick={() => dispatch({ type: 'activate', path: tab.path })}
                        onAuxClick={(event) => event.button === 1 && requestClose(tab.path)}
                        onMouseDown={(event) => event.button === 1 && event.preventDefault()}
                        draggable
                        onDragStart={(event) => {
                            event.dataTransfer.setData('application/x-gobia-tab', tab.path);
                            event.dataTransfer.effectAllowed = 'move';
                            setTabDrag({ path: tab.path, over: null, after: false });
                        }}
                        onDragOver={(event) => {
                            if (!tabDrag) return;
                            event.preventDefault();
                            const box = event.currentTarget.getBoundingClientRect();
                            const after = event.clientX > box.left + box.width / 2;
                            if (tabDrag.over !== tab.path || tabDrag.after !== after)
                                setTabDrag({ ...tabDrag, over: tab.path, after });
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            if (!tabDrag) return;
                            const from = state.tabs.findIndex((candidate) => candidate.path === tabDrag.path);
                            const index = state.tabs.findIndex((candidate) => candidate.path === tab.path);
                            const slot = index + (tabDrag.after ? 1 : 0);
                            dispatch({
                                type: 'reorder',
                                path: tabDrag.path,
                                to: from < slot ? slot - 1 : slot,
                            });
                            setTabDrag(null);
                        }}
                        onDragEnd={() => setTabDrag(null)}
                        className={
                            'gb-tab' +
                            (tab.path === state.active ? ' active' : '') +
                            (tabDrag?.path === tab.path ? ' dragging' : '') +
                            (tabDrag?.over === tab.path && tabDrag.path !== tab.path
                                ? tabDrag.after
                                    ? ' drop-after'
                                    : ' drop-before'
                                : '')
                        }
                    >
                        <button
                            type={'button'}
                            aria-current={tab.path === state.active ? 'true' : undefined}
                            onClick={() => dispatch({ type: 'activate', path: tab.path })}
                            className={'gb-tab-name'}
                        >
                            <FileTypeIcon name={tab.name} size={14} />
                            {tab.name}
                        </button>
                        {isDirty(tab) && (
                            <span aria-label={'unsaved changes'} className={'gb-tree-dirty'}>
                                &bull;
                            </span>
                        )}
                        <button
                            type={'button'}
                            aria-label={`Close ${tab.name}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                requestClose(tab.path);
                            }}
                            className={'gb-tab-close'}
                        >
                            <X size={14} aria-hidden />
                        </button>
                    </div>
                ))}
                {state.tabs.length === 0 && (
                    <span style={{ padding: '9px 12px', fontSize: 13 }} className={'gb-muted'}>
                        No files open
                    </span>
                )}
            </div>

            {active?.status === 'ready' && (
                <>
                    <div className={'gb-editor-bar'}>
                        <span className={'gb-editor-lang'}>{languageLabel(active.name)}</span>
                        <button
                            type={'button'}
                            onClick={() => setProblemsOpen((open) => !open)}
                            aria-expanded={problemsOpen}
                            disabled={problems.length === 0}
                            className={'gb-editor-problems' + (problems.length ? ' error' : '')}
                        >
                            {problems.length === 0 ? 'No problems' : `${problems.length} problem`}
                        </button>
                        <span className={'gb-editor-spacer'} />
                        <label className={'gb-toggle'}>
                            <input
                                type={'checkbox'}
                                checked={wrap}
                                onChange={(event) => setWordWrap(event.currentTarget.checked)}
                            />
                            Word wrap
                        </label>
                        <span
                            className={'gb-save-state ' + saveState(active)}
                            role={'status'}
                            aria-live={'polite'}
                            data-state={saveState(active)}
                        >
                            {SAVE_LABELS[saveState(active)]}
                        </span>
                        {permissions.update && (
                            <button
                                type={'button'}
                                className={'gb-btn gb-btn-primary gb-btn-sm'}
                                disabled={active.saving || !isDirty(active)}
                                onClick={() => void save(active.path)}
                            >
                                {active.saving ? 'Saving…' : 'Save'}
                            </button>
                        )}
                    </div>
                    {problemsOpen && problems.length > 0 && (
                        <ul className={'gb-problems'} aria-label={'Problems'}>
                            {problems.map((found, index) => (
                                <li key={index}>
                                    <button
                                        type={'button'}
                                        onClick={() =>
                                            found.line &&
                                            setReveal({
                                                line: found.line,
                                                column: found.column ?? 1,
                                                nonce: Date.now(),
                                            })
                                        }
                                    >
                                        <span className={'error'}>Error</span>
                                        {found.line && (
                                            <em>
                                                Line {found.line}:{found.column ?? 1}
                                            </em>
                                        )}
                                        {found.message}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                {!active ? (
                    <p
                        className={'gb-muted'}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 24px',
                            textAlign: 'center',
                            fontSize: 14,
                        }}
                    >
                        {mobile
                            ? 'Open the explorer to choose a file.'
                            : 'Select a file in the explorer to open it. Files stay open in tabs while you browse.'}
                    </p>
                ) : active.status === 'loading' ? (
                    <div className={'gb-skeleton'} style={{ position: 'absolute', inset: 16, borderRadius: 10 }} />
                ) : active.status === 'error' ? (
                    <div role={'alert'} style={{ padding: 24 }}>
                        <p className={'gb-badge gb-badge-danger'} style={{ height: 'auto', padding: '8px 12px' }}>
                            {active.error}
                        </p>
                        <div style={{ marginTop: 12 }}>
                            <button
                                type={'button'}
                                className={'gb-btn gb-btn-sm'}
                                onClick={() => void reloadFromServer(active.path)}
                            >
                                Try again
                            </button>
                        </div>
                    </div>
                ) : editorModule ? (
                    <editorModule.default
                        owner={uuid}
                        pane={paneId}
                        path={active.path}
                        content={active.content}
                        original={active.original}
                        revision={active.rev}
                        readOnly={!permissions.update}
                        wordWrap={wrap}
                        mark={mark}
                        openPaths={editorPaths}
                        problem={problem}
                        reveal={reveal}
                        onDirtyChange={(path, dirty) => dispatch({ type: 'dirty', path, dirty })}
                        onSnapshot={(path, content) => dispatch({ type: 'snapshot', path, content })}
                        onSave={() => void save(active.path)}
                        onSaveAll={() => (config.onSaveAll ? config.onSaveAll() : void saveAll())}
                        onFocus={() => config.onFocusPane?.()}
                    />
                ) : (
                    <div className={'gb-skeleton'} style={{ position: 'absolute', inset: 16, borderRadius: 10 }} />
                )}
            </div>
        </>
    );

    const overlays = (
        <>
            <div style={{ marginTop: 12 }}>
                <UploadPanel
                    items={uploads.items}
                    onCancel={uploads.cancel}
                    onRetry={uploads.retry}
                    onClear={uploads.clearFinished}
                />
            </div>

            <ContextMenu menu={menu} onClose={() => setMenu(null)} />

            {prompt?.kind === 'delete' && (
                <Dialog
                    open
                    onClose={() => setPrompt(null)}
                    title={prompt.entries.length === 1 ? `Delete ${prompt.entries[0]?.name}?` : 'Delete these items?'}
                    description={'This cannot be undone. Folders are deleted with everything inside them.'}
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setPrompt(null)}>
                            Cancel
                        </Button.Text>
                        <Button.Danger
                            type={'button'}
                            onClick={() => {
                                const { entries } = prompt;
                                setPrompt(null);
                                void remove(entries);
                            }}
                        >
                            Delete
                        </Button.Danger>
                    </Dialog.Footer>
                </Dialog>
            )}
            {prompt?.kind === 'invalid' && target && (
                <Dialog
                    open
                    onClose={() => setPrompt(null)}
                    title={`${target.name} has a syntax problem`}
                    description={`${prompt.problem.message}${prompt.problem.line ? ` (line ${prompt.problem.line})` : ''}. A broken configuration file can stop the server from starting.`}
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setPrompt(null)}>
                            Keep editing
                        </Button.Text>
                        <Button
                            type={'button'}
                            color={'primary'}
                            onClick={() => {
                                setPrompt(null);
                                void save(target.path, { force: true });
                            }}
                        >
                            Save anyway
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}
            {prompt?.kind === 'conflict' && target && (
                <Dialog
                    open
                    onClose={() => {
                        dismissed.current[target.path] = prompt.remote;
                        setPrompt(null);
                    }}
                    title={
                        prompt.missing ? `${target.name} was moved or deleted` : `${target.name} changed on the server`
                    }
                    description={
                        prompt.missing
                            ? 'The file no longer exists where you opened it. Saving creates it again.'
                            : 'Someone or something else wrote this file after you opened it, and you have unsaved changes. Choose which version to keep.'
                    }
                >
                    <Dialog.Footer>
                        <Button.Text
                            type={'button'}
                            onClick={() => {
                                dismissed.current[target.path] = prompt.remote;
                                setPrompt(null);
                            }}
                        >
                            Cancel
                        </Button.Text>
                        {!prompt.missing && (
                            <Button type={'button'} onClick={() => void compare(target.path)}>
                                Compare
                            </Button>
                        )}
                        {!prompt.missing && (
                            <Button
                                type={'button'}
                                onClick={() => {
                                    setPrompt(null);
                                    void reloadFromServer(target.path);
                                }}
                            >
                                Reload
                            </Button>
                        )}
                        <Button
                            type={'button'}
                            color={'primary'}
                            onClick={() => {
                                setPrompt(null);
                                void save(target.path, { overwrite: true });
                            }}
                        >
                            {prompt.missing ? 'Save as new file' : 'Overwrite'}
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}
            {prompt?.kind === 'compare' && target && (
                <Dialog
                    open
                    onClose={() => {
                        dismissed.current[target.path] = prompt.modified;
                        setPrompt(null);
                    }}
                    title={`Server version of ${target.name} against yours`}
                    description={'Red lines are only on the server. Green lines are only in your tab.'}
                >
                    <Suspense fallback={<div className={'gb-skeleton gb-diff'} />}>
                        <DiffView path={target.path} remote={prompt.remote} mine={target.content} />
                    </Suspense>
                    <Dialog.Footer>
                        <Button.Text
                            type={'button'}
                            onClick={() => {
                                dismissed.current[target.path] = prompt.modified;
                                setPrompt(null);
                            }}
                        >
                            Cancel
                        </Button.Text>
                        <Button
                            type={'button'}
                            onClick={() => {
                                setPrompt(null);
                                void reloadFromServer(target.path);
                            }}
                        >
                            Reload
                        </Button>
                        <Button
                            type={'button'}
                            color={'primary'}
                            onClick={() => {
                                setPrompt(null);
                                void save(target.path, { overwrite: true });
                            }}
                        >
                            Overwrite
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}
            {prompt?.kind === 'close' && target && (
                <Dialog
                    open
                    onClose={() => setPrompt(null)}
                    title={`Close ${target.name}?`}
                    description={'It has unsaved changes.'}
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setPrompt(null)}>
                            Keep open
                        </Button.Text>
                        <Button.Danger
                            type={'button'}
                            onClick={() => {
                                setPrompt(null);
                                dispatch({ type: 'close', path: target.path });
                            }}
                        >
                            Discard changes
                        </Button.Danger>
                        <Button
                            type={'button'}
                            color={'primary'}
                            onClick={() => {
                                setPrompt(null);
                                void save(target.path).then((saved) => {
                                    if (saved) dispatch({ type: 'close', path: target.path });
                                });
                            }}
                        >
                            Save and close
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}
        </>
    );

    const api = {
        uuid,
        paneId,
        tree,
        permissions,
        selectedPaths: () => picked.paths.filter((path) => path !== ROOT),
        /** Whether an open tab of this pane holds unsaved edits for the path (or anything under it). */
        hasUnsaved: (path: string) =>
            latest.current.state.tabs.some(
                (tab) => isDirty(tab) && (tab.path === path || tab.path.startsWith(`${path}/`))
            ),
        /** Closes the clean tabs of files that left this server (a move), keeping any with unsaved work. */
        closeGone: (paths: readonly string[]) => {
            for (const tab of latest.current.state.tabs) {
                const gone = paths.some((path) => tab.path === path || tab.path.startsWith(`${path}/`));
                if (gone && !isDirty(tab)) dispatch({ type: 'close', path: tab.path });
            }
        },
        /** Selects what just arrived, so the person sees where the files landed. */
        select: (paths: string[]) => {
            if (paths.length === 0) return;
            setPicked({ paths, primary: paths.at(-1) ?? null, anchor: paths[0] ?? null });
            setSettled(paths[0] ?? null);
        },
        /** Paths of the open tabs at or under the path. */
        openUnder: (path: string) =>
            latest.current.state.tabs
                .filter((tab) => tab.path === path || tab.path.startsWith(`${path}/`))
                .map((tab) => tab.path),
        /** Saves the tabs with unsaved edits at or under the path; false when one could not be saved. */
        saveUnder: async (path: string): Promise<boolean> => {
            const dirty = latest.current.state.tabs.filter(
                (tab) => isDirty(tab) && (tab.path === path || tab.path.startsWith(`${path}/`))
            );
            for (const tab of dirty) {
                // eslint-disable-next-line no-await-in-loop
                if (!(await save(tab.path))) return false;
            }
            return true;
        },
        /** Closes the tabs with unsaved edits at or under the path without saving them. */
        discardUnder: (path: string) => {
            for (const tab of latest.current.state.tabs) {
                if (isDirty(tab) && (tab.path === path || tab.path.startsWith(`${path}/`))) {
                    dispatch({ type: 'close', path: tab.path });
                }
            }
        },
        /** Whether the explorer knows the path as a file or a folder (undefined when it has not listed it). */
        kindOf: (path: string): 'file' | 'directory' | undefined => {
            for (const listing of Object.values(tree.listings)) {
                if (listing === 'loading' || 'error' in listing) continue;
                const entry = listing.items.find((candidate) => candidate.path === path);
                if (entry) return entry.directory ? 'directory' : 'file';
            }
            return undefined;
        },
        /** Opens a file by path in a tab (after a move, in the pane it moved to). */
        openPath: async (path: string) => {
            const entry = await statFile(uuid, path);
            if (entry && !entry.directory) openFile(entry);
        },
        dirtyCount: state.tabs.filter(isDirty).length,
    };

    return { explorer, editor, overlays, uuid, tree, state, active, save, saveAll, dispatch, api };
}
