import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as monaco from 'monaco-editor';

// This module (and therefore all of Monaco) is only ever loaded through React.lazy from the file workspace.

export interface EditorFile {
    path: string;
    language: string;
    content: string;
    // Changes when the content was replaced from the server (reload), so the model is rebuilt.
    revision: number;
}

export interface MarkerInput {
    message: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    severity: 'error' | 'warning';
}

export interface EditorHandle {
    getContent: (path: string) => string | undefined;
    // Shows problems as red/yellow underlines. Passing an empty list clears them.
    setMarkers: (path: string, markers: MarkerInput[]) => void;
    // Moves the cursor to a position in the given file's model (which must be the active one) and focuses it.
    reveal: (path: string, line: number, column: number) => void;
    markSaved: (path: string) => void;
    focus: () => void;
    runAction: (id: string) => void;
    // Gives an open file a new path (rename or move) without losing its text, unsaved edits or cursor. Monaco cannot
    // change the URI of a model, so the text moves to a fresh model at the new URI. False if the file is not loaded.
    rename: (from: string, to: string, language: string) => boolean;
}

interface Props {
    files: EditorFile[];
    activePath: string | null;
    wordWrap: boolean;
    minimap: boolean;
    readOnly: boolean;
    onDirtyChange: (path: string, dirty: boolean) => void;
    onContentChange: (path: string) => void;
    onSave: () => void;
}

interface Entry {
    path: string;
    model: monaco.editor.ITextModel;
    revision: number;
    savedVersion: number;
    viewState: monaco.editor.ICodeEditorViewState | null;
}

let configured = false;

// Disposing a model or an editor while Monaco is still computing something (folding, tokens, validation) rejects that
// work with a cancellation. It is how Monaco stops work that is no longer wanted, so it is not an error worth reporting.
const ignoreCancellation = (e: PromiseRejectionEvent | ErrorEvent) => {
    const reason = 'reason' in e ? e.reason : e.error;
    if (reason && (reason.name === 'Canceled' || reason.message === 'Canceled')) e.preventDefault();
};

// Monaco has no built-in .properties or TOML grammar, so give them a small comment/key/value highlighter.
const configure = () => {
    if (configured) return;
    configured = true;

    monaco.languages.register({ id: 'properties' });
    monaco.languages.setMonarchTokensProvider('properties', {
        tokenizer: {
            root: [
                [/^\s*[#!].*$/, 'comment'],
                [/^([^=:\s]+)(\s*[=:]\s*)/, ['key', 'delimiter']],
                [/\$\{[^}]*\}/, 'variable'],
                [/\b(true|false)\b/, 'keyword'],
                [/-?\d+(\.\d+)?\b/, 'number'],
            ],
        },
    });

    monaco.languages.register({ id: 'toml' });
    monaco.languages.setMonarchTokensProvider('toml', {
        tokenizer: {
            root: [
                [/#.*$/, 'comment'],
                [/^\s*\[\[?[^\]]*\]\]?/, 'type'],
                [/^([\w.\-"]+)(\s*=)/, ['key', 'delimiter']],
                [/"([^"\\]|\\.)*"/, 'string'],
                [/'[^']*'/, 'string'],
                [/\b(true|false)\b/, 'keyword'],
                [/-?\d[\d_.:eE+-]*/, 'number'],
            ],
        },
    });

    monaco.editor.defineTheme('gobia-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [{ token: 'key', foreground: '7dc4e4' }],
        colors: {
            'editor.background': '#111a25',
            'editor.lineHighlightBackground': '#172333',
            'editorLineNumber.foreground': '#4b6078',
            'editorLineNumber.activeForeground': '#9db2c9',
            'editorGutter.background': '#111a25',
            'editor.selectionBackground': '#27507a99',
            'editorWidget.background': '#16212e',
            'editorSuggestWidget.background': '#16212e',
        },
    });

    // Not an inverted dark theme: every token colour is chosen to keep at least a 4.5:1 contrast on the light surface.
    monaco.editor.defineTheme('gobia-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '5b6b7c', fontStyle: 'italic' },
            { token: 'key', foreground: '0b6a8f' },
            { token: 'keyword', foreground: '6d3fc4' },
            { token: 'string', foreground: '0f6b3a' },
            { token: 'number', foreground: 'b4540a' },
            { token: 'type', foreground: '0b6a8f' },
            { token: 'delimiter', foreground: '4a5a6b' },
            { token: 'variable', foreground: '9a3412' },
        ],
        colors: {
            'editor.background': '#fbfcfe',
            'editor.foreground': '#1c2733',
            'editor.lineHighlightBackground': '#eef3f9',
            'editorLineNumber.foreground': '#8b9bb0',
            'editorLineNumber.activeForeground': '#3b4b5e',
            'editorGutter.background': '#fbfcfe',
            'editor.selectionBackground': '#bcd7f866',
            'editorCursor.foreground': '#1d6fd1',
            'editorWidget.background': '#ffffff',
            'editorIndentGuide.background1': '#e3e9f1',
        },
    });
};

const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'gobia-light' : 'gobia-dark');

export default forwardRef<EditorHandle, Props>(
    ({ files, activePath, wordWrap, minimap, readOnly, onDirtyChange, onContentChange, onSave }, ref) => {
        const container = useRef<HTMLDivElement>(null);
        const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
        const entries = useRef(new Map<string, Entry>());
        const active = useRef<string | null>(null);
        const callbacks = useRef({ onDirtyChange, onContentChange, onSave });
        callbacks.current = { onDirtyChange, onContentChange, onSave };

        const createEntry = (path: string, language: string, content: string, revision: number): Entry => {
            const model = monaco.editor.createModel(content, language, monaco.Uri.from({ scheme: 'file', path }));
            const entry: Entry = {
                path,
                model,
                revision,
                savedVersion: model.getAlternativeVersionId(),
                viewState: null,
            };
            model.onDidChangeContent(() => {
                callbacks.current.onDirtyChange(entry.path, model.getAlternativeVersionId() !== entry.savedVersion);
                callbacks.current.onContentChange(entry.path);
            });

            return entry;
        };

        useImperativeHandle(ref, () => ({
            getContent: (path) => entries.current.get(path)?.model.getValue(),
            markSaved: (path) => {
                const entry = entries.current.get(path);
                if (entry) {
                    entry.savedVersion = entry.model.getAlternativeVersionId();
                    callbacks.current.onDirtyChange(path, false);
                }
            },
            setMarkers: (path, markers) => {
                const model = entries.current.get(path)?.model;
                if (!model) return;

                monaco.editor.setModelMarkers(
                    model,
                    'gobia',
                    markers.map((m) => ({
                        severity: m.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
                        message: m.message,
                        startLineNumber: m.line,
                        startColumn: m.column,
                        endLineNumber: m.endLine ?? m.line,
                        endColumn:
                            m.endColumn ??
                            Math.max(m.column + 1, model.getLineMaxColumn(Math.min(m.line, model.getLineCount()))),
                    }))
                );
            },
            reveal: (path, line, column) => {
                if (active.current !== path || !editor.current) return;
                editor.current.setPosition({ lineNumber: line, column });
                editor.current.revealLineInCenter(line);
                editor.current.focus();
            },
            focus: () => editor.current?.focus(),
            runAction: (id) => editor.current?.getAction(id)?.run(),
            rename: (from, to, language) => {
                const entry = entries.current.get(from);
                if (!entry || from === to) return !!entry;

                const instance = editor.current;
                const wasActive = active.current === from;
                const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersion;
                const viewState = wasActive ? instance?.saveViewState() ?? null : entry.viewState;
                const next = createEntry(to, language, entry.model.getValue(), entry.revision);
                // The new model starts a new version history: it counts as saved unless the old one had unsaved edits,
                // in which case it must keep reading as modified.
                next.savedVersion = dirty ? -1 : next.model.getAlternativeVersionId();
                next.viewState = viewState;

                entries.current.delete(from);
                entries.current.set(to, next);
                if (wasActive) {
                    active.current = to;
                    instance?.setModel(next.model);
                    if (viewState) instance?.restoreViewState(viewState);
                }
                entry.model.dispose();
                callbacks.current.onDirtyChange(to, dirty);

                return true;
            },
        }));

        useEffect(() => {
            configure();
            editor.current = monaco.editor.create(container.current!, {
                theme: currentTheme(),
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 14,
                tabSize: 4,
                multiCursorModifier: 'alt',
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                model: null,
            });

            editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave());

            window.addEventListener('unhandledrejection', ignoreCancellation);
            window.addEventListener('error', ignoreCancellation);
            // Follow the Panel theme live, including a System theme that changes while the editor is open.
            const watcher = new MutationObserver(() => monaco.editor.setTheme(currentTheme()));
            watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

            return () => {
                watcher.disconnect();
                window.removeEventListener('unhandledrejection', ignoreCancellation);
                window.removeEventListener('error', ignoreCancellation);
                entries.current.forEach((entry) => entry.model.dispose());
                entries.current.clear();
                editor.current?.dispose();
                editor.current = null;
            };
        }, []);

        // Keep one text model per open file so each tab keeps its own undo history, cursor and unsaved edits.
        useEffect(() => {
            const wanted = new Set(files.map((f) => f.path));

            entries.current.forEach((entry, path) => {
                if (!wanted.has(path)) {
                    if (active.current === path) active.current = null;
                    entry.model.dispose();
                    entries.current.delete(path);
                }
            });

            files.forEach((file) => {
                const existing = entries.current.get(file.path);
                if (existing && existing.revision === file.revision) return;

                if (existing) {
                    existing.model.setValue(file.content);
                    existing.revision = file.revision;
                    existing.savedVersion = existing.model.getAlternativeVersionId();
                    callbacks.current.onDirtyChange(file.path, false);

                    return;
                }

                entries.current.set(file.path, createEntry(file.path, file.language, file.content, file.revision));
            });
        }, [files]);

        useEffect(() => {
            const instance = editor.current;
            if (!instance) return;

            if (active.current && entries.current.has(active.current)) {
                entries.current.get(active.current)!.viewState = instance.saveViewState();
            }

            const next = activePath ? entries.current.get(activePath) : undefined;
            active.current = next ? activePath : null;
            instance.setModel(next?.model || null);
            if (next?.viewState) instance.restoreViewState(next.viewState);
            if (next) instance.focus();
        }, [activePath, files]);

        useEffect(() => {
            editor.current?.updateOptions({
                wordWrap: wordWrap ? 'on' : 'off',
                minimap: { enabled: minimap },
                readOnly,
            });
        }, [wordWrap, minimap, readOnly]);

        return <div ref={container} style={{ width: '100%', height: '100%' }} />;
    }
);
