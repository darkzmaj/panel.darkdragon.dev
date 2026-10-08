import { useEffect, useRef } from 'react';
import { applyTheme, languageOf, monaco } from './monaco';
import type { Problem } from './validation';

export interface CodeEditorProps {
    /** Identifies the document; every open path keeps its own model (text, undo history) while its tab is open. */
    path: string;
    content: string;
    readOnly: boolean;
    onChange: (content: string) => void;
    onSave: () => void;
    wordWrap?: boolean;
    /** Reports a named point of the load path (see timing.ts); passed in so this chunk shares no module with the workspace. */
    mark: (name: string, once?: boolean) => void;
    /** Paths with an open tab. Models of any other path are disposed. */
    openPaths: readonly string[];
    /** Syntax problem of the file in front, drawn as an editor marker. */
    problem?: Problem | null;
    /** Move the cursor to a position and scroll it into view; a new `nonce` repeats the request. */
    reveal?: { line: number; column: number; nonce: number } | null;
}

const uriOf = (path: string) => monaco.Uri.from({ scheme: 'gobia', path });
const isDark = () => document.documentElement.classList.contains('dark');

/**
 * One Monaco editor for the whole workspace: it is created once and switches models when the tab changes, so undo
 * history, selection and scroll position survive switching. Minimap is off by design.
 */
export default function CodeEditor({
    path,
    content,
    readOnly,
    onChange,
    onSave,
    wordWrap = false,
    mark,
    openPaths,
    problem = null,
    reveal = null,
}: CodeEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
    const current = useRef<string | null>(null);
    const callbacks = useRef({ onChange, onSave });
    callbacks.current = { onChange, onSave };

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
        instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave());
        const observer = new MutationObserver(() => applyTheme(isDark()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        const open = views.current;
        return () => {
            observer.disconnect();
            typed.dispose();
            instance.dispose();
            editor.current = null;
            open.clear();
            current.current = null;
            for (const model of monaco.editor.getModels()) if (model.uri.scheme === 'gobia') model.dispose();
        };
    }, []);

    // Show the model of the active path, creating it from the tab's text the first time.
    useEffect(() => {
        const instance = editor.current;
        if (!instance) return;
        if (current.current !== null && current.current !== path) {
            views.current.set(current.current, instance.saveViewState());
        }
        current.current = path;
        const uri = uriOf(path);
        let model = monaco.editor.getModel(uri);
        if (!model) model = monaco.editor.createModel(content, languageOf(path), uri);
        // Text replaced from outside (reload from disk, overwrite) is pushed in as one undoable edit.
        else if (model.getValue() !== content) model.setValue(content);
        instance.setModel(model);
        mark('file-visible');
        const saved = views.current.get(path);
        if (saved) instance.restoreViewState(saved);
        const subscription = model.onDidChangeContent(() => callbacks.current.onChange(model.getValue()));
        return () => subscription.dispose();
        // `content` only seeds a new model; later edits flow out through onChange and back in as the same string.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path]);

    // A change of text from outside while the path stays the same (reload, overwrite).
    useEffect(() => {
        const model = monaco.editor.getModel(uriOf(path));
        if (model && model.getValue() !== content) model.setValue(content);
    }, [path, content]);

    useEffect(() => {
        editor.current?.updateOptions({ readOnly, wordWrap: wordWrap ? 'on' : 'off' });
    }, [readOnly, wordWrap]);

    // Dispose the models, and forget the view state, of tabs that were closed.
    useEffect(() => {
        const keep = new Set(openPaths);
        for (const model of monaco.editor.getModels()) {
            if (model.uri.scheme === 'gobia' && !keep.has(model.uri.path)) model.dispose();
        }
        for (const known of [...views.current.keys()]) if (!keep.has(known)) views.current.delete(known);
    }, [openPaths]);

    useEffect(() => {
        const model = monaco.editor.getModel(uriOf(path));
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
    }, [problem, path, content]);

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
