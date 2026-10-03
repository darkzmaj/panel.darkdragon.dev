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
    model: monaco.editor.ITextModel;
    revision: number;
    savedVersion: number;
    viewState: monaco.editor.ICodeEditorViewState | null;
}

let configured = false;

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
        colors: { 'editor.background': '#1b232b', 'editor.lineHighlightBackground': '#243039' },
    });
};

export default forwardRef<EditorHandle, Props>(
    ({ files, activePath, wordWrap, minimap, readOnly, onDirtyChange, onContentChange, onSave }, ref) => {
        const container = useRef<HTMLDivElement>(null);
        const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
        const entries = useRef(new Map<string, Entry>());
        const active = useRef<string | null>(null);
        const callbacks = useRef({ onDirtyChange, onContentChange, onSave });
        callbacks.current = { onDirtyChange, onContentChange, onSave };

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
        }));

        useEffect(() => {
            configure();
            editor.current = monaco.editor.create(container.current!, {
                theme: 'gobia-dark',
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

            return () => {
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

                const model = monaco.editor.createModel(
                    file.content,
                    file.language,
                    monaco.Uri.from({ scheme: 'file', path: file.path })
                );
                const entry: Entry = {
                    model,
                    revision: file.revision,
                    savedVersion: model.getAlternativeVersionId(),
                    viewState: null,
                };
                model.onDidChangeContent(() => {
                    callbacks.current.onDirtyChange(file.path, model.getAlternativeVersionId() !== entry.savedVersion);
                    callbacks.current.onContentChange(file.path);
                });
                entries.current.set(file.path, entry);
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
