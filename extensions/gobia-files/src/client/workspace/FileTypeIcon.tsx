import {
    BY_EXTENSION,
    BY_EXTENSION_LIGHT,
    BY_FOLDER,
    BY_FOLDER_OPEN,
    BY_NAME,
    BY_NAME_LIGHT,
    GENERIC,
    ICONS,
} from './fileIcons.generated';

interface Resolved {
    dark: string;
    /** A variant drawn for light backgrounds, when the theme has one. */
    light: string | null;
}

/** The icon of a file name, from the Material Icon Theme: by file name first, then by extension. */
export function fileIcon(name: string): Resolved {
    const lower = name.toLowerCase();
    const byName = BY_NAME[lower];
    if (byName) return { dark: byName, light: BY_NAME_LIGHT[lower] ?? null };
    let extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    if (lower === '.env' || lower.startsWith('.env.')) extension = 'env';
    const found = extension ? BY_EXTENSION[extension] : undefined;
    return found ? { dark: found, light: BY_EXTENSION_LIGHT[extension] ?? null } : { dark: GENERIC.file, light: null };
}

/** The icon of a folder: special names (config, plugins, src…) have their own, the rest the plain folder. */
export function folderIcon(name: string, open: boolean, root = false): Resolved {
    const lower = name.toLowerCase();
    if (root) return { dark: open ? GENERIC.rootOpen : GENERIC.root, light: null };
    const special = (open ? BY_FOLDER_OPEN : BY_FOLDER)[lower];
    return { dark: special ?? (open ? GENERIC.folderOpen : GENERIC.folder), light: null };
}

interface Props {
    name: string;
    folder?: boolean;
    open?: boolean;
    root?: boolean;
    size?: number;
    className?: string;
}

/** The explorer, tab and search result icon: real VS Code (Material Icon Theme) artwork, decorative, fixed size. */
export default function FileTypeIcon({
    name,
    folder = false,
    open = false,
    root = false,
    size = 16,
    className,
}: Props) {
    const icon = folder ? folderIcon(name, open, root) : fileIcon(name);
    const classes = 'gb-ftype' + (className ? ` ${className}` : '');
    const source = (key: string) => ICONS[key] ?? ICONS[GENERIC.file] ?? '';
    const key = icon.dark;

    if (icon.light) {
        return (
            <>
                <img
                    className={`${classes} gb-only-dark`}
                    src={source(key)}
                    width={size}
                    height={size}
                    alt={''}
                    aria-hidden
                    draggable={false}
                    data-icon={key}
                />
                <img
                    className={`${classes} gb-only-light`}
                    src={source(icon.light)}
                    width={size}
                    height={size}
                    alt={''}
                    aria-hidden
                    draggable={false}
                    data-icon={icon.light}
                />
            </>
        );
    }

    return (
        <img
            className={classes}
            src={source(key)}
            width={size}
            height={size}
            alt={''}
            aria-hidden
            draggable={false}
            data-icon={key}
        />
    );
}
