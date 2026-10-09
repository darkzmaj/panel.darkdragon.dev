import { useEffect, useRef } from 'react';
import { applyTheme, languageOf, monaco } from './monaco';
import type { Problem } from './validation';

export interface CodeEditorProps {
    /** The server the document belongs to. Part of every model's identity: two servers may both hold `plugins/config.yml`. */
    owner: string;
    /** Which pane of the workspace the editor sits in; panes never share a model, even for the same server. */
    pane: string;
    /** Identifies the document; every open path keeps its own model (text, undo history) while its tab is open. */
    path: string;
    /** Text that seeds a new model, and replaces the model's text when `revision` changes. */
    content: string;
    /** The text as last read from or written to the server: a model equal to it is clean. */
    original: string;
    /** Bumped when the text is replaced from outside the editor (reload from disk, search and replace). */
    revision: number;
    readOnly: boolean;
    /** Only reports the edited or clean state, and only when it flips: typing never re-renders the workspace. */
    onDirtyChange: (path: string, dirty: boolean) => void;
    /** The text, shortly after typing stops, for the problem list, search and the remembered session. */
    onSnapshot: (path: string, content: string) => void;
    onSave: () => void;
    onSaveAll: () => void;
    onFocus: () => void;
    wordWrap?: boolean;
    /** Reports a named point of the load path (see timing.ts); passed in so this chunk shares no module with the workspace. */
    mark: (name: string, once?: boolean) => void;
    /** Paths with an open tab in this pane. Models of any other path of the pane are disposed. */
    openPaths: readonly string[];
    /** Syntax problem of the file in front, drawn as an editor marker. */
    problem?: Problem | null;
    /** Move the cursor to a position and scroll it into view; a new `nonce` repeats the request. */
    reveal?: { line: number; column: number; nonce: number } | null;
    /** Changes each time the Find button is pressed; opens the editor's own find widget like Ctrl+F. */
    find?: number;
}

const SNAPSHOT_MS = 150;

const uriOf = (owner: string, pane: string, path: string) =>
    monaco.Uri.from({ scheme: 'gobia', authority: owner, path, query: pane });
const isDark = () => document.documentElement.classList.contains('dark');
const modelOf = (owner: string, pane: string, path: string) => monaco.editor.getModel(uriOf(owner, pane, path));

// The alternative version id a model had when it was last in step with the server. Undoing back to it is clean again.
const savedVersion = new Map<string, number>();
const key = (model: monaco.editor.ITextModel) => model.uri.toString();

/** The text of a document, read from its model. Null when the editor has no model for it (yet). */
export function readText(owner: string, pane: string, path: string): string | null {
    return modelOf(owner, pane, path)?.getValue() ?? null;
}

/** A token for the text as it is now; hand it back to `markSaved` once that exact text reached the server. */
export function versionToken(owner: string, pane: string, path: string): number | null {
    return modelOf(owner, pane, path)?.getAlternativeVersionId() ?? null;
}

/** Records that the text of `token` is on the server. Edits made while the save ran stay unsaved. Returns whether clean. */
export function markSaved(owner: string, pane: string, path: string, token: number): boolean {
    const model = modelOf(owner, pane, path);
    if (!model) return true;
    savedVersion.set(key(model), token);
    return model.getAlternativeVersionId() === token;
}

export function hasEdits(owner: string, pane: string, path: string): boolean {
    const model = modelOf(owner, pane, path);
    return model ? savedVersion.get(key(model)) !== model.getAlternativeVersionId() : false;
}

/**
 * Monaco for one pane of the workspace. It is created once and switches models when the tab changes, so undo
 * history, selection and scroll position survive switching. Minimap is off by design.
 */
export default function CodeEditor({
    owner,
    pane,
    path,
    content,
    original,
    revision,
    readOnly,
    onDirtyChange,
    onSnapshot,
    onSave,
    onSaveAll,
    onFocus,
    wordWrap = false,
    mark,
    openPaths,
    problem = null,
    reveal = null,
    find = 0,
}: CodeEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
    const current = useRef<string | null>(null);
    const callbacks = useRef({ onDirtyChange, onSnapshot, onSave, onSaveAll, onFocus });
    callbacks.current = { onDirtyChange, onSnapshot, onSave, onSaveAll, onFocus };
    const identity = useRef({ owner, pane });
    identity.current = { owner, pane };
    const revisions = useRef(new Map<string, number>());

    useEffect(() => {
        mark('editor-create', true);
        const instance = monaco.editor.create(host.current as HTMLElement, {
            model: null,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
            tabSize: 4,
            fixedOverflowWidgets: true,
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            occurrencesHighlight: 'singleFile',
            scrollbar: { alwaysConsumeMouseWheel: false },
            padding: { top: 8, bottom: 8 },
        });
        editor.current = instance;
        applyTheme(isDark());
        mark('monaco-ready', true);
        const typed = instance.onKeyDown(() => mark('first-key', true));
        const focused = instance.onDidFocusEditorText(() => callbacks.current.onFocus());
        // Monaco owns the shortcut while it has focus and keeps the browser's Save Page dialog from opening; the
        // workspace handles it for the rest of the page.
        // addCommand binds the key for every editor on the page unless a context says otherwise: scope it to this
        // editor, or the last editor created would answer Ctrl+S for all of them.
        const mine = `editorId == '${instance.getId()}'`;
        instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave(), mine);
        instance.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
            () => callbacks.current.onSaveAll(),
            mine
        );
        const observer = new MutationObserver(() => applyTheme(isDark()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        const open = views.current;
        return () => {
            observer.disconnect();
            typed.dispose();
            focused.dispose();
            instance.dispose();
            editor.current = null;
            open.clear();
            current.current = null;
            const { owner: leaving, pane: from } = identity.current;
            for (const model of monaco.editor.getModels()) {
                if (model.uri.scheme === 'gobia' && model.uri.query === from && model.uri.authority === leaving) {
                    savedVersion.delete(key(model));
                    model.dispose();
                }
            }
        };
    }, []);

    // Show the model of the active path, creating it from the tab's text the first time.
    useEffect(() => {
        const instance = editor.current;
        if (!instance) return;
        if (current.current !== null && current.current !== `${owner}\n${path}`) {
            views.current.set(current.current, instance.saveViewState());
        }
        current.current = `${owner}\n${path}`;
        const uri = uriOf(owner, pane, path);
        let model = monaco.editor.getModel(uri);
        if (!model) {
            // A restored session can hold unsaved text: the model starts from the server's text and takes the edit
            // on top, so it reads as modified and undo still reaches the saved text.
            model = monaco.editor.createModel(original, languageOf(path), uri);
            savedVersion.set(key(model), model.getAlternativeVersionId());
            if (content !== original) model.setValue(content);
            revisions.current.set(uri.toString(), revision);
        }
        instance.setModel(model);
        mark('file-visible');
        const saved = views.current.get(`${owner}\n${path}`);
        if (saved) instance.restoreViewState(saved);

        const target = model;
        let dirty = savedVersion.get(key(target)) !== target.getAlternativeVersionId();
        let timer: number | undefined;
        const subscription = target.onDidChangeContent(() => {
            const now = savedVersion.get(key(target)) !== target.getAlternativeVersionId();
            if (now !== dirty) {
                dirty = now;
                callbacks.current.onDirtyChange(path, now);
            }
            window.clearTimeout(timer);
            timer = window.setTimeout(() => callbacks.current.onSnapshot(path, target.getValue()), SNAPSHOT_MS);
        });
        return () => {
            subscription.dispose();
            if (timer !== undefined) {
                // Do not lose the last keystrokes when the tab or the server changes inside the debounce window.
                window.clearTimeout(timer);
                if (!target.isDisposed()) callbacks.current.onSnapshot(path, target.getValue());
            }
        };
        // `content` only seeds a new model; later edits flow out through the callbacks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [owner, pane, path]);

    // Text replaced from outside the editor (reload from disk, overwrite, replace in files): one undoable edit.
    useEffect(() => {
        const model = modelOf(owner, pane, path);
        if (!model) return;
        const seen = revisions.current.get(model.uri.toString());
        if (seen === revision) return;
        revisions.current.set(model.uri.toString(), revision);
        if (model.getValue() !== content) model.setValue(content);
        if (content === original) savedVersion.set(key(model), model.getAlternativeVersionId());
        callbacks.current.onDirtyChange(path, savedVersion.get(key(model)) !== model.getAlternativeVersionId());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision]);

    useEffect(() => {
        editor.current?.updateOptions({ readOnly, wordWrap: wordWrap ? 'on' : 'off' });
    }, [readOnly, wordWrap]);

    // Dispose the models, and forget the view state, of this pane's closed tabs and of servers the pane left.
    useEffect(() => {
        const keep = new Set(openPaths);
        for (const model of monaco.editor.getModels()) {
            if (model.uri.scheme !== 'gobia' || model.uri.query !== pane) continue;
            if (model.uri.authority !== owner || !keep.has(model.uri.path)) {
                savedVersion.delete(key(model));
                revisions.current.delete(model.uri.toString());
                model.dispose();
            }
        }
        for (const known of [...views.current.keys()]) {
            const [who, where] = known.split('\n');
            if (who !== owner || !keep.has(where ?? '')) views.current.delete(known);
        }
    }, [openPaths, owner, pane]);

    useEffect(() => {
        const model = modelOf(owner, pane, path);
        if (!model) return;
        monaco.editor.setModelMarkers(
            model,
            'gobia',
            problem
                ? [
                      {
                          severity: monaco.MarkerSeverity.Error,
                          message: problem.message,
                          startLineNumber: problem.line ?? 1,
                          startColumn: problem.column ?? 1,
                          endLineNumber: problem.line ?? 1,
                          endColumn: problem.line ? model.getLineMaxColumn(problem.line) : model.getLineMaxColumn(1),
                      },
                  ]
                : []
        );
    }, [problem, owner, pane, path, content]);

    useEffect(() => {
        if (find === 0) return;
        const instance = editor.current;
        instance?.focus();
        void instance?.getAction('actions.find')?.run();
    }, [find]);

    useEffect(() => {
        const instance = editor.current;
        if (!instance || !reveal) return;
        const position = { lineNumber: reveal.line, column: reveal.column };
        instance.setPosition(position);
        instance.revealPositionInCenterIfOutsideViewport(position);
        instance.focus();
    }, [reveal]);

    return <div ref={host} className={'gf:h-full gf:min-h-0 gf:overflow-hidden'} data-testid={'code-editor'} />;
}

let warmed = false;

/**
 * Initialises Monaco's shared services (themes, fonts, the first tokenizer) on a detached editor, so the first real
 * editor of the session does not pay for them while the user waits for a file. Safe to call more than once.
 */
export function warmUp() {
    if (warmed) return;
    warmed = true;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:120px;visibility:hidden';
    document.body.append(host);
    try {
        applyTheme(isDark());
        const model = monaco.editor.createModel('{"warm": [1, 2, 3]}', 'json');
        const editor = monaco.editor.create(host, { model, minimap: { enabled: false }, automaticLayout: false });
        editor.dispose();
        model.dispose();
    } finally {
        host.remove();
    }
}
