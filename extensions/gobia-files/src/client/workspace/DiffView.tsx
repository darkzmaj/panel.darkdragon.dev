import { useEffect, useRef } from 'react';
import { applyTheme, languageOf, monaco } from './monaco';

interface Props {
    path: string;
    /** The version on the server. */
    remote: string;
    /** The version in the tab. */
    mine: string;
}

/** Read only inline diff of the server's file against the tab's text, in the same Monaco chunk as the editor. */
export default function DiffView({ path, remote, mine }: Props) {
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const language = languageOf(path);
        const original = monaco.editor.createModel(remote, language);
        const modified = monaco.editor.createModel(mine, language);
        applyTheme(document.documentElement.classList.contains('dark'));
        const diff = monaco.editor.createDiffEditor(host.current as HTMLElement, {
            automaticLayout: true,
            readOnly: true,
            renderSideBySide: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            originalEditable: false,
            ignoreTrimWhitespace: false,
        });
        diff.setModel({ original, modified });
        return () => {
            diff.dispose();
            original.dispose();
            modified.dispose();
        };
    }, [path, remote, mine]);

    return <div ref={host} className={'gb-diff'} data-testid={'diff-view'} aria-label={'Server version against yours'} />;
}
