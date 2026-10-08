import { Button, Dialog, httpErrorToHuman, toast, useCurrentServer, type ReplacementProps } from '@pterodactyl/sdk';
import {
    Archive,
    ArchiveRestore,
    CopyPlus,
    Download,
    FilePlus,
    FolderPlus,
    FolderUp,
    Link2,
    Menu,
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
    renameEntries,
    versionOf,
    writeFile,
    type TreeEntry,
} from './api';
import ContextMenu, { type MenuItem, type MenuState } from './ContextMenu';
import { MAX_EDIT_BYTES, basename, dirname, join } from './paths';
import { loadTabs, saveTabs, takePendingOpen } from './session';
import { isDirty, tabsReducer } from './tabs';
import type { FileResult } from './search';
import SearchPanel, { type ReplaceResult } from './SearchPanel';
import Tree, { ROOT, validTarget, type Inline } from './Tree';
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

export default function Workspace({ model }: ReplacementProps<'server.files.manager'>) {
    const uuid = useCurrentServer((server) => server.attributes.uuid) ?? '';
    const [state, dispatch] = useReducer(tabsReducer, uuid, loadTabs);
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
    const tree = useTree(uuid, treeSource);
    const [prompt, setPrompt] = useState<Prompt | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [selection, setSelection] = useState<string | null>(null);
    const [inline, setInline] = useState<Inline | null>(null);
    const [explorerView, setExplorerView] = useState<'files' | 'search'>('files');
    const [settled, setSettled] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
    const [sidebar, setSidebar] = useState(() => readStored(SIDEBAR_KEY, 288));
    const [wrap, setWrap] = useState(() => readStored(WRAP_KEY, 0) === 1);
    const [problemsOpen, setProblemsOpen] = useState(false);
    const [problem, setProblem] = useState<Problem | null>(null);
    const [reveal, setReveal] = useState<{ line: number; column: number; nonce: number } | null>(null);
    // Bumped when a tab's text is replaced from outside the editor (reload), so the editor is rebuilt for it.
    const filePicker = useRef<HTMLInputElement>(null);
    const folderPicker = useRef<HTMLInputElement>(null);
    const uploadTarget = useRef<string>(ROOT);
    const latest = useRef({ state, tree });
    useEffect(() => {
        latest.current = { state, tree };
    });

    const permissions = model.permissions;

    useEffect(() => mark('workspace-mounted', true), []);
    useEffect(() => {
        const pending = takePendingOpen(uuid);
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
                    window.setTimeout(loaded.warmUp, 0);
                }),
            50
        );
        return () => window.clearTimeout(timer);
    }, [explorerReady]);

    useEffect(() => {
        const query = window.matchMedia('(max-width: 767px)');
        const change = () => setMobile(query.matches);
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, []);

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
            dispatch({ type: 'restore', state: loadTabs(uuid) });
            return;
        }
        saveTabs(uuid, state);
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
            setDrawer(false);
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

    const save = useCallback(
        async (path: string, force = false) => {
            const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
            if (!tab || tab.status !== 'ready' || tab.saving) return false;

            if (!force) {
                const found = await validate(tab.name, tab.content);
                if (found) {
                    setPrompt({ kind: 'invalid', path, problem: found });
                    return false;
                }
            }
            try {
                const remote = await modifiedAt(uuid, path);
                if (remote !== tab.modifiedAt) {
                    setPrompt({ kind: 'conflict', path, missing: remote === null, remote });
                    return false;
                }
                dispatch({ type: 'saving', path, saving: true });
                await writeFile(uuid, path, tab.content);
                dispatch({ type: 'saved', path, content: tab.content, modifiedAt: await modifiedAt(uuid, path) });
                void tree.reload([dirname(path)]);
                toast.success(`Saved ${tab.name}.`);
                return true;
            } catch (error) {
                dispatch({ type: 'saving', path, saving: false });
                toast.error(httpErrorToHuman(error as Error));
                return false;
            }
        },
        [uuid, tree]
    );

    /** Write regardless of what is on disk now: used after the user confirmed overwriting an outside change. */
    const overwrite = async (path: string) => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
        if (!tab) return;
        try {
            dispatch({ type: 'saving', path, saving: true });
            await writeFile(uuid, path, tab.content);
            dispatch({ type: 'saved', path, content: tab.content, modifiedAt: await modifiedAt(uuid, path) });
            void tree.reload([dirname(path)]);
            toast.success(`Saved ${tab.name}.`);
        } catch (error) {
            dispatch({ type: 'saving', path, saving: false });
            toast.error(httpErrorToHuman(error as Error));
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
        setDrawer(false);
        if (!exists) await load(path);
        setReveal({ line, column, nonce: Date.now() });
    };

    /** Applies a search replacement to an open tab (left unsaved) or to the file on disk. */
    const replaceInFile = async (result: FileResult, change: (text: string) => string): Promise<ReplaceResult> => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === result.path);
        if (tab) {
            if (tab.status !== 'ready') return { ok: false, reason: 'it is still loading' };
            const before = tab.content;
            dispatch({ type: 'edit', path: tab.path, content: change(before) });
            return { ok: true, undo: async () => dispatch({ type: 'edit', path: tab.path, content: before }) };
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
    const tabStrip = useRef<HTMLDivElement>(null);
    const [tabDrag, setTabDrag] = useState<{ path: string; over: string | null; after: boolean } | null>(null);
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
        setDrawer(false);
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
                throw error;
            }
            void tree.reload([directory]);
            if (what === 'file') {
                dispatch({ type: 'open', path, name });
                await load(path);
            } else {
                tree.expand(path);
            }
        });

    const rename = (from: string, to: string) =>
        guard(async () => {
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
                throw error;
            }
            tree.expand(dirname(to));
            void tree.reload([dirname(from), dirname(to)]);
        });

    const remove = (entries: readonly TreeEntry[]) =>
        guard(async () => {
            const byDirectory = new Map<string, TreeEntry[]>();
            for (const entry of entries)
                byDirectory.set(dirname(entry.path), [...(byDirectory.get(dirname(entry.path)) ?? []), entry]);
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
                void tree.reload([...byDirectory.keys()], true);
                throw error;
            }
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

    const moveInto = (from: string, directory: string) => {
        const listing = latest.current.tree.listings[directory];
        const taken =
            listing && listing !== 'loading' && 'items' in listing
                ? new Set(listing.items.map((item) => item.name))
                : undefined;
        if (!validTarget(from, directory, taken)) {
            if (taken?.has(basename(from))) toast.error(`${basename(from)} already exists in that folder.`);
            return;
        }
        void rename(from, join(directory, basename(from)));
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

    const searching = explorerView === 'search';
    const pane = (shown: boolean): React.CSSProperties => ({
        display: shown ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
    });
    const explorer = (
        <>
            <div style={pane(searching)}>
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
            <div style={pane(!searching)}>
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
                    style={{ flex: 1, overflow: 'auto', padding: '4px 0', minHeight: 0 }}
                    onKeyDown={(event) => {
                        const entry = selectedEntry();
                        if (!entry) return;
                        if (event.key === 'F2' && permissions.update) {
                            event.preventDefault();
                            setInline({ kind: 'rename', entry });
                        } else if (event.key === 'Delete' && permissions.delete) {
                            event.preventDefault();
                            setPrompt({ kind: 'delete', entries: [entry] });
                        }
                    }}
                >
                    <Tree
                        tree={tree}
                        selection={selection}
                        activePath={state.active}
                        openPaths={openPaths}
                        dirtyPaths={dirtyPaths}
                        canMove={permissions.update}
                        canUpload={permissions.create}
                        onSelect={setSelection}
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

    return (
        <div className={'gb-page'}>
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
                <p className={'gb-workspace-path'} title={state.active ?? ''}>
                    {state.active ?? 'File editor'}
                </p>
            </div>

            <div className={'gb-workspace'} style={{ height: 'calc(100dvh - 11rem)', minHeight: 420 }}>
                {!mobile && (
                    <>
                        <aside className={'gb-explorer'} style={{ width: sidebar }} aria-label={'File explorer'}>
                            {explorer}
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
                    style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
                >
                    <div
                        ref={tabStrip}
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
                                {permissions.update && (
                                    <button
                                        type={'button'}
                                        className={'gb-btn gb-btn-primary gb-btn-sm'}
                                        disabled={busy || active.saving || !isDirty(active)}
                                        onClick={() => void save(active.path)}
                                    >
                                        Save
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
                            <div
                                className={'gb-skeleton'}
                                style={{ position: 'absolute', inset: 16, borderRadius: 10 }}
                            />
                        ) : active.status === 'error' ? (
                            <div role={'alert'} style={{ padding: 24 }}>
                                <p
                                    className={'gb-badge gb-badge-danger'}
                                    style={{ height: 'auto', padding: '8px 12px' }}
                                >
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
                                path={active.path}
                                content={active.content}
                                readOnly={!permissions.update}
                                wordWrap={wrap}
                                mark={mark}
                                openPaths={editorPaths}
                                problem={problem}
                                reveal={reveal}
                                onChange={(content) => dispatch({ type: 'edit', path: active.path, content })}
                                onSave={() => void save(active.path)}
                            />
                        ) : (
                            <div
                                className={'gb-skeleton'}
                                style={{ position: 'absolute', inset: 16, borderRadius: 10 }}
                            />
                        )}
                    </div>
                </section>

                {mobile && drawer && (
                    <>
                        <div className={'gb-drawer-mask'} onClick={() => setDrawer(false)} aria-hidden />
                        <aside className={'gb-drawer'} aria-label={'File explorer'}>
                            {explorer}
                        </aside>
                    </>
                )}
            </div>

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
                                void save(target.path, true);
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
                                void overwrite(target.path);
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
                                void overwrite(target.path);
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
        </div>
    );
}
