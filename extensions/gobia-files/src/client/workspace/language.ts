import type { Extension } from '@codemirror/state';

type Loader = () => Promise<Extension>;

const loaders = {
    json: () => import('@codemirror/lang-json').then((m) => m.json()),
    yml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
    yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
    xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
    html: () => import('@codemirror/lang-html').then((m) => m.html()),
    css: () => import('@codemirror/lang-css').then((m) => m.css()),
    js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
    mjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
    ts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
    py: () => import('@codemirror/lang-python').then((m) => m.python()),
    php: () => import('@codemirror/lang-php').then((m) => m.php()),
    java: () => import('@codemirror/lang-java').then((m) => m.java()),
    md: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
    sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
    toml: () =>
        Promise.all([import('@codemirror/language'), import('@codemirror/legacy-modes/mode/toml')]).then(
            ([language, mode]) => language.StreamLanguage.define(mode.toml)
        ),
    properties: () =>
        Promise.all([import('@codemirror/language'), import('@codemirror/legacy-modes/mode/properties')]).then(
            ([language, mode]) => language.StreamLanguage.define(mode.properties)
        ),
    sh: () =>
        Promise.all([import('@codemirror/language'), import('@codemirror/legacy-modes/mode/shell')]).then(
            ([language, mode]) => language.StreamLanguage.define(mode.shell)
        ),
} satisfies Record<string, Loader>;
const LOADERS = new Map<string, Loader>(Object.entries(loaders));

/** Syntax highlighting for a file name, or null for plain text. Each language loads on first use. */
export function languageFor(name: string): Promise<Extension | null> {
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const load = LOADERS.get(extension);
    return load ? load() : Promise.resolve(null);
}
