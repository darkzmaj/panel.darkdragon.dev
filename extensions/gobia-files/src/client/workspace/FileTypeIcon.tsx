import { File as GenericFile } from 'lucide-react';

interface Kind {
    /** Short mark drawn on the badge. */
    mark: string;
    /** Badge colour, readable on dark and light surfaces. */
    color: string;
    /** Mark colour; white unless the badge is light. */
    ink?: string;
}

const JSON_: Kind = { mark: '{}', color: '#cbb12b', ink: '#1a1a1a' };
const CONFIG: Kind = { mark: 'CF', color: '#6b7a90' };
const SHELL: Kind = { mark: '$_', color: '#3f4a5a' };
const IMAGE: Kind = { mark: 'IMG', color: '#a35fcf' };
const ARCHIVE: Kind = { mark: 'ZIP', color: '#a0722d' };

// One badge per language or format: its colour and a two or three letter mark. Extensions share a badge where the
// language is the same. Anything unknown falls back to the plain file icon.
const KINDS = new Map<string, Kind>([
    ['json', JSON_],
    ['jsonc', JSON_],
    ['json5', JSON_],
    ['rs', { mark: 'RS', color: '#c2552a' }],
    ['java', { mark: 'JV', color: '#d2691e' }],
    ['kt', { mark: 'KT', color: '#7f52ff' }],
    ['kts', { mark: 'KT', color: '#7f52ff' }],
    ['scala', { mark: 'SC', color: '#c22d40' }],
    ['groovy', { mark: 'GR', color: '#4298b8' }],
    ['gradle', { mark: 'GR', color: '#02303a' }],
    ['py', { mark: 'PY', color: '#3776ab' }],
    ['js', { mark: 'JS', color: '#e6c722', ink: '#1a1a1a' }],
    ['mjs', { mark: 'JS', color: '#e6c722', ink: '#1a1a1a' }],
    ['cjs', { mark: 'JS', color: '#e6c722', ink: '#1a1a1a' }],
    ['jsx', { mark: 'JSX', color: '#2aa7c9' }],
    ['ts', { mark: 'TS', color: '#3178c6' }],
    ['tsx', { mark: 'TSX', color: '#2aa7c9' }],
    ['html', { mark: 'HT', color: '#e34f26' }],
    ['htm', { mark: 'HT', color: '#e34f26' }],
    ['css', { mark: 'CSS', color: '#2965f1' }],
    ['scss', { mark: 'SC', color: '#c6538c' }],
    ['sass', { mark: 'SA', color: '#c6538c' }],
    ['less', { mark: 'LS', color: '#1d365d' }],
    ['go', { mark: 'GO', color: '#00add8' }],
    ['php', { mark: 'PHP', color: '#777bb4' }],
    ['rb', { mark: 'RB', color: '#cc342d' }],
    ['lua', { mark: 'LU', color: '#000080' }],
    ['c', { mark: 'C', color: '#5c6bc0' }],
    ['h', { mark: 'H', color: '#5c6bc0' }],
    ['cpp', { mark: 'C++', color: '#00599c' }],
    ['cc', { mark: 'C++', color: '#00599c' }],
    ['hpp', { mark: 'H++', color: '#00599c' }],
    ['cs', { mark: 'C#', color: '#68217a' }],
    ['swift', { mark: 'SW', color: '#f05138' }],
    ['dart', { mark: 'DT', color: '#0175c2' }],
    ['r', { mark: 'R', color: '#276dc3' }],
    ['pl', { mark: 'PL', color: '#39457e' }],
    ['sql', { mark: 'SQL', color: '#e48e00' }],
    ['yml', { mark: 'YML', color: '#cb171e' }],
    ['yaml', { mark: 'YML', color: '#cb171e' }],
    ['toml', { mark: 'TML', color: '#9c4221' }],
    ['md', { mark: 'MD', color: '#4a7fb5' }],
    ['markdown', { mark: 'MD', color: '#4a7fb5' }],
    ['txt', { mark: 'TXT', color: '#7b8794' }],
    ['log', { mark: 'LOG', color: '#7b8794' }],
    ['sh', SHELL],
    ['bash', SHELL],
    ['zsh', SHELL],
    ['bat', SHELL],
    ['cmd', SHELL],
    ['ps1', { mark: 'PS', color: '#2671be' }],
    ['xml', { mark: 'XML', color: '#e37933' }],
    ['svg', { mark: 'SVG', color: '#ffb13b', ink: '#1a1a1a' }],
    ['properties', CONFIG],
    ['cfg', CONFIG],
    ['conf', CONFIG],
    ['ini', CONFIG],
    ['env', CONFIG],
    ['lock', { mark: 'LK', color: '#7b8794' }],
    ['dockerfile', { mark: 'DK', color: '#2496ed' }],
    ['csv', { mark: 'CSV', color: '#2e8b57' }],
    ['png', IMAGE],
    ['jpg', IMAGE],
    ['jpeg', IMAGE],
    ['gif', IMAGE],
    ['webp', IMAGE],
    ['ico', IMAGE],
    ['zip', ARCHIVE],
    ['gz', ARCHIVE],
    ['tgz', ARCHIVE],
    ['tar', ARCHIVE],
    ['rar', ARCHIVE],
    ['7z', ARCHIVE],
    ['jar', { mark: 'JAR', color: '#d2691e' }],
]);

const BY_NAME = new Map<string, Kind>([
    ['dockerfile', { mark: 'DK', color: '#2496ed' }],
    ['makefile', { mark: 'MK', color: '#6d8086' }],
    ['.env', CONFIG],
    ['.gitignore', { mark: 'GIT', color: '#f1502f' }],
    ['.gitattributes', { mark: 'GIT', color: '#f1502f' }],
]);

export function kindOf(name: string): Kind | null {
    const lower = name.toLowerCase();
    const byName = BY_NAME.get(lower);
    if (byName) return byName;
    const dot = lower.lastIndexOf('.');

    return dot > 0 || (dot === 0 && lower.length > 1) ? (KINDS.get(lower.slice(dot + 1)) ?? null) : null;
}

/** The icon of a file in the explorer, the tabs and the search results, chosen from its name. */
export default function FileTypeIcon({
    name,
    size = 16,
    className,
}: {
    name: string;
    size?: number;
    className?: string;
}) {
    const kind = kindOf(name);
    if (!kind) return <GenericFile className={className ?? 'gb-tree-file'} width={size} height={size} aria-hidden />;
    const long = kind.mark.length;

    return (
        <svg
            className={'gb-file-badge' + (className ? ` ${className}` : '')}
            width={size}
            height={size}
            viewBox={'0 0 16 16'}
            aria-hidden
            focusable={'false'}
            data-kind={kind.mark}
        >
            <rect x={0.5} y={2} width={15} height={12} rx={3} fill={kind.color} />
            <text
                x={8}
                y={11}
                textAnchor={'middle'}
                fontSize={long >= 3 ? 5.6 : long === 2 ? 7 : 8}
                fontWeight={700}
                fontFamily={'ui-sans-serif, system-ui, sans-serif'}
                fill={kind.ink ?? '#fff'}
            >
                {kind.mark}
            </text>
        </svg>
    );
}
