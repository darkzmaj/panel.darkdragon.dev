// Maps a file name to a Monaco language id without importing Monaco itself, so tabs can be
// labelled before the editor chunk has loaded. Unknown files are plain text.
const BY_EXTENSION: Record<string, string> = {
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    properties: 'properties',
    toml: 'toml',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    java: 'java',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    xml: 'xml',
    html: 'html',
    htm: 'html',
    css: 'css',
    md: 'markdown',
    py: 'python',
};

const BY_NAME: Record<string, string> = {
    dockerfile: 'dockerfile',
    '.env': 'ini',
    '.bashrc': 'shell',
    '.gitignore': 'plaintext',
};

export const languageForFile = (name: string): string => {
    const lower = name.toLowerCase();
    if (BY_NAME[lower]) return BY_NAME[lower];

    const dot = lower.lastIndexOf('.');

    return dot < 0 ? 'plaintext' : BY_EXTENSION[lower.slice(dot + 1)] || 'plaintext';
};

export const LANGUAGE_LABELS: Record<string, string> = {
    plaintext: 'Plain Text',
    json: 'JSON',
    yaml: 'YAML',
    properties: 'Properties',
    toml: 'TOML',
    ini: 'INI',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    java: 'Java',
    php: 'PHP',
    shell: 'Shell',
    xml: 'XML',
    html: 'HTML',
    css: 'CSS',
    markdown: 'Markdown',
    python: 'Python',
    dockerfile: 'Dockerfile',
};

// Files above this size ask before opening; above the hard limit they can only be downloaded.
export const WARN_BYTES = 1024 * 1024;
export const MAX_BYTES = 10 * 1024 * 1024;
