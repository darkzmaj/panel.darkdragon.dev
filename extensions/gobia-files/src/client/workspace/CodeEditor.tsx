import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { languageFor } from './language';

export interface CodeEditorProps {
    /** Identifies the document; every path keeps its own undo history and cursor while its tab is open. */
    path: string;
    content: string;
    readOnly: boolean;
    onChange: (content: string) => void;
    onSave: () => void;
}

// Colours come from the theme tokens, so the editor stays readable in light and dark mode.
const highlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.operator, tags.tagName, tags.modifier], color: 'var(--primary)' },
    {
        tag: [tags.string, tags.special(tags.string), tags.regexp],
        color: 'color-mix(in srgb, var(--primary) 45%, var(--foreground))',
    },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'color-mix(in srgb, var(--foreground) 75%, orange)' },
    {
        tag: [tags.propertyName, tags.definition(tags.variableName), tags.attributeName],
        color: 'var(--foreground)',
        fontWeight: '600',
    },
    { tag: [tags.comment, tags.meta], color: 'var(--muted-foreground)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--destructive)' },
]);

const theme = EditorView.theme({
    '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', overflow: 'auto' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)' },
    '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
    '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
    },
});

export default function CodeEditor({ path, content, readOnly, onChange, onSave }: CodeEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const states = useRef(new Map<string, EditorState>());
    const language = useRef(new Compartment());
    const current = useRef(path);
    const callbacks = useRef({ onChange, onSave });

    useEffect(() => {
        callbacks.current = { onChange, onSave };
    });

    useEffect(() => {
        const open = states.current;
        const editor = new EditorView({ parent: host.current ?? undefined });
        view.current = editor;
        return () => {
            editor.destroy();
            view.current = null;
            open.clear();
        };
    }, []);

    useEffect(() => {
        const editor = view.current;
        if (!editor) return;
        const previous = current.current;
        if (previous !== path) states.current.set(previous, editor.state);
        current.current = path;

        let state = states.current.get(path);
        if (!state || state.doc.toString() !== content) {
            state = EditorState.create({
                doc: content,
                extensions: [
                    lineNumbers(),
                    foldGutter(),
                    highlightActiveLineGutter(),
                    highlightActiveLine(),
                    history(),
                    drawSelection(),
                    indentOnInput(),
                    bracketMatching(),
                    highlightSelectionMatches(),
                    syntaxHighlighting(highlight),
                    language.current.of([]),
                    keymap.of([
                        {
                            key: 'Mod-s',
                            preventDefault: true,
                            run: () => {
                                callbacks.current.onSave();
                                return true;
                            },
                        },
                        indentWithTab,
                        ...searchKeymap,
                        ...historyKeymap,
                        ...defaultKeymap,
                    ]),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
                    }),
                    EditorState.readOnly.of(readOnly),
                    EditorView.editable.of(!readOnly),
                    theme,
                ],
            });
        }
        editor.setState(state);

        let stale = false;
        void languageFor(path).then((extension) => {
            if (!stale && current.current === path) {
                editor.dispatch({ effects: language.current.reconfigure(extension ?? []) });
            }
        });
        return () => {
            stale = true;
        };
        // The document is created from `content` only when the path changes; later edits flow out through onChange.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, readOnly]);

    return <div ref={host} className={'gf:h-full gf:min-h-0 gf:overflow-hidden'} data-testid={'code-editor'} />;
}
