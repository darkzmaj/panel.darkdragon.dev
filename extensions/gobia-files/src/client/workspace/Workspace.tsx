import {
    Button,
    Dialog,
    Spinner,
    httpErrorToHuman,
    toast,
    useCurrentServer,
    type FileManagerEntry,
    type ReplacementProps,
} from '@pterodactyl/sdk';
import { CheckCircle2, FolderOpen, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import { modifiedAt, readFile, writeFile } from './api';
import { WorkspaceContext, type WorkspaceContextValue } from './context';
import ExplorerList from './Explorer';
import { MAX_EDIT_BYTES, basename, join } from './paths';
import { loadTabs, saveTabs } from './session';
import TabBar from './TabBar';
import { isDirty, tabsReducer, type Tab } from './tabs';
import Toolbar from './Toolbar';
import UploadPanel from './UploadPanel';
import { useUploadQueue } from './uploads';
import { formatOf, validate, type Problem } from './validation';

// CodeMirror and the language packs are only fetched once a file is actually opened.
const CodeEditor = lazy(() => import('./CodeEditor'));

type Prompt =
    | { kind: 'invalid'; path: string; problem: Problem }
    | { kind: 'conflict'; path: string; missing: boolean }
    | { kind: 'close'; path: string }
    | { kind: 'newFile' };

const input =
    'gf:w-full gf:rounded-md gf:border gf:border-input gf:bg-background gf:px-3 gf:py-2 gf:text-sm gf:text-foreground';

function NewFileDialog({
    directory,
    onSubmit,
    onClose,
}: {
    directory: string;
    onSubmit: (name: string) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState('');
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (name.trim() !== '') onSubmit(name.trim());
    };
    return (
        <Dialog open onClose={onClose} title={'New file'} description={`Created in ${directory}`}>
            <form onSubmit={submit} className={'gf:flex gf:flex-col gf:gap-4'}>
                <label className={'gf:flex gf:flex-col gf:gap-1 gf:text-sm'}>
                    File name
                    <input
                        autoFocus
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                        className={input}
                    />
                </label>
                <Dialog.Footer>
                    <Button.Text type={'button'} onClick={onClose}>
                        Cancel
                    </Button.Text>
                    <Button type={'submit'} color={'primary'} disabled={name.trim() === ''}>
                        Create
                    </Button>
                </Dialog.Footer>
            </form>
        </Dialog>
    );
}

function ValidationBar({ tab }: { tab: Tab }) {
    const format = formatOf(tab.name);
    const [problem, setProblem] = useState<Problem | null>(null);
    useEffect(() => {
        if (!format) return;
        let stale = false;
        const timer = setTimeout(() => {
            void validate(tab.name, tab.content).then((result) => {
                if (!stale) setProblem(result);
            });
        }, 300);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [format, tab.name, tab.content]);

    if (!format) return null;
    return problem ? (
        <p
            role={'alert'}
            className={
                'gf:flex gf:items-center gf:gap-2 gf:border-t gf:border-border gf:bg-warning gf:px-3 gf:py-1.5 gf:text-xs gf:text-warning-foreground'
            }
        >
            <TriangleAlert size={14} aria-hidden />
            <span>
                {format.toUpperCase()} problem
                {problem.line
                    ? ` at line ${problem.line}${problem.column ? `, column ${problem.column}` : ''}`
                    : ''}:{' '}
                {problem.message}
            </span>
        </p>
    ) : (
        <p
            className={
                'gf:flex gf:items-center gf:gap-2 gf:border-t gf:border-border gf:px-3 gf:py-1.5 gf:text-xs gf:text-muted-foreground'
            }
        >
            <CheckCircle2 size={14} aria-hidden /> Valid {format.toUpperCase()}
        </p>
    );
}

export default function Workspace({ model, Default, parts }: ReplacementProps<'server.files.manager'>) {
    const uuid = useCurrentServer((server) => server.attributes.uuid) ?? '';
    const [state, dispatch] = useReducer(tabsReducer, uuid, loadTabs);
    const [prompt, setPrompt] = useState<Prompt | null>(null);
    const [drawer, setDrawer] = useState(false);
    // Bumped when a tab's text is replaced from outside the editor (reload), so the editor is rebuilt for it.
    const [reloads, setReloads] = useState<Record<string, number>>({});
    const latest = useRef({ state, model });
    useEffect(() => {
        latest.current = { state, model };
    });

    const uploads = useUploadQueue(uuid, () => void latest.current.model.actions.refresh());
    const addUploads = uploads.add;

    useEffect(() => saveTabs(uuid, state), [uuid, state]);

    const anyDirty = state.tabs.some(isDirty);
    useEffect(() => {
        if (!anyDirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [anyDirty]);

    const load = useCallback(
        async (path: string) => {
            try {
                const [content, remote] = await Promise.all([readFile(uuid, path), modifiedAt(uuid, path)]);
                dispatch({ type: 'loaded', path, content, modifiedAt: remote });
            } catch (error) {
                dispatch({ type: 'failed', path, error: httpErrorToHuman(error as Error) });
            }
        },
        [uuid]
    );

    const openFile = useCallback(
        (entry: FileManagerEntry) => {
            if (entry.size > MAX_EDIT_BYTES) {
                toast.error(`${entry.name} is larger than 2 MB. Download it to edit it.`);
                return;
            }
            const exists = latest.current.state.tabs.some((tab) => tab.path === entry.path);
            dispatch({ type: 'open', path: entry.path, name: entry.name });
            setDrawer(false);
            if (!exists) void load(entry.path);
        },
        [load]
    );

    const save = useCallback(
        async (path: string, force = false) => {
            const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
            if (!tab || tab.status !== 'ready' || tab.saving) return false;

            if (!force) {
                const problem = await validate(tab.name, tab.content);
                if (problem) {
                    setPrompt({ kind: 'invalid', path, problem });
                    return false;
                }
            }
            try {
                const remote = await modifiedAt(uuid, path);
                if (remote !== tab.modifiedAt) {
                    setPrompt({ kind: 'conflict', path, missing: remote === null });
                    return false;
                }
                dispatch({ type: 'saving', path, saving: true });
                await writeFile(uuid, path, tab.content);
                dispatch({ type: 'saved', path, content: tab.content, modifiedAt: await modifiedAt(uuid, path) });
                void latest.current.model.actions.refresh();
                toast.success(`Saved ${tab.name}.`);
                return true;
            } catch (error) {
                dispatch({ type: 'saving', path, saving: false });
                toast.error(httpErrorToHuman(error as Error));
                return false;
            }
        },
        [uuid]
    );

    /** Write regardless of what is on disk now: used after the user confirmed overwriting an outside change. */
    const overwrite = async (path: string) => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
        if (!tab) return;
        try {
            dispatch({ type: 'saving', path, saving: true });
            await writeFile(uuid, path, tab.content);
            dispatch({ type: 'saved', path, content: tab.content, modifiedAt: await modifiedAt(uuid, path) });
            void latest.current.model.actions.refresh();
            toast.success(`Saved ${tab.name}.`);
        } catch (error) {
            dispatch({ type: 'saving', path, saving: false });
            toast.error(httpErrorToHuman(error as Error));
        }
    };

    const reloadFromServer = async (path: string) => {
        dispatch({ type: 'open', path, name: basename(path) });
        await load(path);
        setReloads((current) => ({ ...current, [path]: (current[path] ?? 0) + 1 }));
    };

    const requestClose = useCallback((path: string) => {
        const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
        if (tab && isDirty(tab)) setPrompt({ kind: 'close', path });
        else dispatch({ type: 'close', path });
    }, []);

    const createFile = async (name: string) => {
        setPrompt(null);
        const path = join(model.directory, name);
        try {
            await writeFile(uuid, path, '');
            await model.actions.refresh();
            dispatch({ type: 'open', path, name: basename(path) });
            await load(path);
        } catch (error) {
            toast.error(httpErrorToHuman(error as Error));
        }
    };

    const context = useMemo<WorkspaceContextValue>(
        () => ({
            openFile,
            newFile: () => setPrompt({ kind: 'newFile' }),
            upload: (picked, folder) =>
                void addUploads(
                    folder ? join(latest.current.model.directory, folder) : latest.current.model.directory,
                    picked
                ),
            openPaths: new Set(state.tabs.map((tab) => tab.path)),
            // Clean tabs of renamed or deleted files are closed; a tab with unsaved work stays so nothing is lost.
            forget: (paths) =>
                paths.forEach((path) => {
                    const tab = latest.current.state.tabs.find((candidate) => candidate.path === path);
                    if (tab && !isDirty(tab)) dispatch({ type: 'close', path });
                }),
        }),
        [openFile, addUploads, state.tabs]
    );

    const active = state.tabs.find((tab) => tab.path === state.active) ?? null;
    const target = prompt && 'path' in prompt ? state.tabs.find((tab) => tab.path === prompt.path) : undefined;

    return (
        <WorkspaceContext.Provider value={context}>
            <div className={'gf:flex gf:flex-col gf:gap-3'}>
                <div className={'gf:flex gf:items-center gf:justify-between gf:md:hidden'}>
                    <Button type={'button'} onClick={() => setDrawer((open) => !open)} aria-expanded={drawer}>
                        <FolderOpen size={16} aria-hidden /> {drawer ? 'Back to editor' : 'Files'}
                    </Button>
                </div>
                <div className={'gf:grid gf:gap-4 gf:md:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]'}>
                    <aside
                        aria-label={'File explorer'}
                        className={(drawer ? 'gf:block ' : 'gf:hidden ') + 'gf:min-w-0 gf:md:block'}
                    >
                        {/* Core still supplies the selection bar (move, archive, delete) under the list. */}
                        <Default parts={{ toolbar: Toolbar, list: ExplorerList, selection: parts.selection }} />
                        <div className={'gf:mt-3'}>
                            <UploadPanel
                                items={uploads.items}
                                onCancel={uploads.cancel}
                                onRetry={uploads.retry}
                                onClear={uploads.clearFinished}
                            />
                        </div>
                    </aside>

                    <section
                        aria-label={'Editor'}
                        className={
                            (drawer ? 'gf:hidden ' : 'gf:flex ') +
                            'gf:min-w-0 gf:flex-col gf:overflow-hidden gf:rounded-lg gf:border gf:border-border gf:bg-card gf:md:flex gf:h-[calc(100dvh-14rem)] gf:min-h-[24rem]'
                        }
                    >
                        <TabBar
                            tabs={state.tabs}
                            active={state.active}
                            onActivate={(path) => dispatch({ type: 'activate', path })}
                            onClose={requestClose}
                        />
                        {!active ? (
                            <div
                                className={
                                    'gf:grid gf:flex-1 gf:place-items-center gf:p-6 gf:text-center gf:text-sm gf:text-muted-foreground'
                                }
                            >
                                Open a file from the explorer to edit it. Several files can stay open at once.
                            </div>
                        ) : active.status === 'loading' ? (
                            <Spinner size={'large'} centered />
                        ) : active.status === 'error' ? (
                            <div role={'alert'} className={'gf:p-6 gf:text-sm gf:text-destructive'}>
                                {active.error}
                                <div className={'gf:mt-3'}>
                                    <Button type={'button'} onClick={() => void reloadFromServer(active.path)}>
                                        Try again
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className={'gf:min-h-0 gf:flex-1'}>
                                    <Suspense fallback={<Spinner size={'large'} centered />}>
                                        <CodeEditor
                                            key={`${active.path}:${reloads[active.path] ?? 0}`}
                                            path={active.path}
                                            content={active.content}
                                            readOnly={!model.permissions.update}
                                            onChange={(content) =>
                                                dispatch({ type: 'edit', path: active.path, content })
                                            }
                                            onSave={() => void save(active.path)}
                                        />
                                    </Suspense>
                                </div>
                                <ValidationBar tab={active} />
                                <div
                                    className={
                                        'gf:flex gf:items-center gf:justify-between gf:gap-2 gf:border-t gf:border-border gf:px-3 gf:py-2'
                                    }
                                >
                                    <span
                                        className={'gf:min-w-0 gf:truncate gf:text-xs gf:text-muted-foreground'}
                                        title={active.path}
                                    >
                                        {active.path}
                                    </span>
                                    {model.permissions.update && (
                                        <Button
                                            type={'button'}
                                            color={'primary'}
                                            isLoading={active.saving}
                                            disabled={!isDirty(active)}
                                            onClick={() => void save(active.path)}
                                        >
                                            Save
                                        </Button>
                                    )}
                                </div>
                            </>
                        )}
                    </section>
                </div>
            </div>

            {prompt?.kind === 'newFile' && (
                <NewFileDialog
                    directory={model.directory}
                    onClose={() => setPrompt(null)}
                    onSubmit={(name) => void createFile(name)}
                />
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
                    onClose={() => setPrompt(null)}
                    title={
                        prompt.missing ? `${target.name} was moved or deleted` : `${target.name} changed on the server`
                    }
                    description={
                        prompt.missing
                            ? 'The file no longer exists where you opened it. Saving creates it again.'
                            : 'Someone or something else wrote this file after you opened it. Saving now replaces their version.'
                    }
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setPrompt(null)}>
                            Cancel
                        </Button.Text>
                        {!prompt.missing && (
                            <Button
                                type={'button'}
                                onClick={() => {
                                    setPrompt(null);
                                    void reloadFromServer(target.path);
                                }}
                            >
                                Discard mine and reload
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
        </WorkspaceContext.Provider>
    );
}
