// Everything Monaco needs, loaded as one lazy chunk by CodeEditor. Imports are the editor core plus only the features
// the workspace uses (no minimap, no language services, no suggestions), so the chunk stays well below the full bundle.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment';
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding';
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation';
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect';
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations';
import 'monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';

export { monaco };

// The only worker is the generic editor worker (diffs, word ranges); JSON/TS language workers are not shipped.
// ponytail: relative URL so the worker resolves against the extension bundle, not the page.
const environment: monaco.Environment = {
    getWorker: () =>
        new Worker(new URL('../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {
            type: 'module',
        }),
};
Object.assign(self, { MonacoEnvironment: environment });

monaco.languages.register({ id: 'json', extensions: ['.json', '.mcmeta'] });
monaco.languages.setMonarchTokensProvider('json', {
    tokenizer: {
        root: [
            [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
            [/"(?:[^"\\]|\\.)*"/, 'string'],
            [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
            [/\b(?:true|false|null)\b/, 'keyword'],
            [/\/\/.*$/, 'comment'],
            [/[{}[\],:]/, 'delimiter'],
        ],
    },
});
monaco.languages.setLanguageConfiguration('json', {
    brackets: [
        ['{', '}'],
        ['[', ']'],
    ],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"', notIn: ['string'] },
    ],
});

monaco.languages.register({ id: 'toml', extensions: ['.toml'] });
monaco.languages.setMonarchTokensProvider('toml', {
    tokenizer: {
        root: [
            [/#.*$/, 'comment'],
            [/^\s*\[\[?[^\]]+\]\]?/, 'type'],
            [/^\s*[\w.-]+(?=\s*=)/, 'variable'],
            [/"""/, { token: 'string', next: '@multiline' }],
            [/"(?:[^"\\]|\\.)*"|'[^']*'/, 'string'],
            [/\b(?:true|false)\b/, 'keyword'],
            [/[+-]?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        ],
        multiline: [
            [/"""/, { token: 'string', next: '@pop' }],
            [/[^"]+|"/, 'string'],
        ],
    },
});

const EXTENSIONS = new Map<string, string>([
    ['json', 'json'],
    ['yml', 'yaml'],
    ['yaml', 'yaml'],
    ['toml', 'toml'],
    ['xml', 'xml'],
    ['html', 'html'],
    ['htm', 'html'],
    ['css', 'css'],
    ['js', 'javascript'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['ts', 'typescript'],
    ['py', 'python'],
    ['php', 'php'],
    ['java', 'java'],
    ['md', 'markdown'],
    ['sql', 'sql'],
    ['sh', 'shell'],
    ['bash', 'shell'],
    ['properties', 'ini'],
    ['ini', 'ini'],
    ['cfg', 'ini'],
    ['conf', 'ini'],
]);

/** The Monaco language id for a file name; plain text when unknown. */
export function languageOf(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name === '.env' || name.startsWith('.env.')) return 'ini';
    if (!name.includes('.')) return 'plaintext';
    return EXTENSIONS.get(name.slice(name.lastIndexOf('.') + 1).toLowerCase()) ?? 'plaintext';
}

// Monaco wants literal colours, so the Gobia tokens are resolved through a probe element; this keeps the editor in step
// with whatever palette the theme (light, dark, or a custom accent) currently defines.
function resolve(token: string, property: 'color' | 'backgroundColor' = 'color'): string {
    const probe = document.createElement('span');
    probe.style[property] = `var(${token})`;
    document.body.append(probe);
    const value = getComputedStyle(probe)[property];
    probe.remove();
    const found = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(value);
    if (!found) return '#808080';
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
    const alpha = found[4] ? hex(String(Math.round(Number(found[4]) * 255))) : '';
    return `#${hex(found[1] ?? '0')}${hex(found[2] ?? '0')}${hex(found[3] ?? '0')}${alpha}`;
}

const THEME = 'gobia';

/** (Re)defines the Gobia editor theme from the current CSS tokens; call again when the scheme changes. */
export function applyTheme(dark: boolean) {
    const text = resolve('--gb-text');
    const muted = resolve('--gb-text-3');
    const primary = resolve('--gb-primary');
    const background = resolve('--gb-bg', 'backgroundColor');
    const surface = resolve('--gb-surface', 'backgroundColor');
    const hover = resolve('--gb-hover', 'backgroundColor');
    const border = resolve('--gb-border');
    const strip = (colour: string) => colour.slice(1, 7);
    monaco.editor.defineTheme(THEME, {
        base: dark ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
            { token: 'comment', foreground: strip(muted), fontStyle: 'italic' },
            { token: 'keyword', foreground: strip(primary) },
            { token: 'string', foreground: dark ? '9ece6a' : '3a7d1e' },
            { token: 'number', foreground: dark ? 'ff9e64' : 'b45309' },
            { token: 'type', foreground: dark ? '7dcfff' : '0e7490' },
            { token: 'variable', foreground: strip(text) },
        ],
        colors: {
            'editor.background': background,
            'editor.foreground': text,
            'editorLineNumber.foreground': muted,
            'editorLineNumber.activeForeground': text,
            'editor.lineHighlightBackground': hover,
            'editor.lineHighlightBorder': '#00000000',
            'editorGutter.background': background,
            'editorWidget.background': surface,
            'editorWidget.border': border,
            'editorSuggestWidget.background': surface,
            'input.background': background,
            'input.border': border,
            'focusBorder': primary,
            'editor.selectionBackground': primary + '44',
            'editor.findMatchBackground': primary + '66',
            'editor.findMatchHighlightBackground': primary + '33',
            'scrollbarSlider.background': muted + '33',
            'scrollbarSlider.hoverBackground': muted + '55',
            'editorIndentGuide.background1': border,
        },
    });
    monaco.editor.setTheme(THEME);
}
