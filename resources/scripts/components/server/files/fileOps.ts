import { basename, dirname, join } from 'pathe';

// Pure path rules shared by the file list, the workspace explorer and the drag and drop handlers.

export const normalize = (path: string): string => {
    const clean = '/' + path.split('/').filter(Boolean).join('/');

    return clean;
};

/** True when `path` is `parent` itself or lives anywhere below it. */
export const isInside = (parent: string, path: string): boolean => {
    const p = normalize(parent);
    const c = normalize(path);

    return p === '/' || c === p || c.startsWith(p + '/');
};

export interface MoveCheck {
    ok: boolean;
    // Why the move was refused; shown to the person doing it.
    reason?: string;
    // A move onto itself is not an error, it simply does nothing.
    noop?: boolean;
}

/** A path with `.` or `..` segments, an empty name or a NUL byte can never be a valid target. */
export const hasUnsafeSegments = (path: string): boolean =>
    path.includes('\0') || path.split('/').some((s) => s === '..' || s === '.');

/**
 * Decides whether `source` (a full path) may be moved into the directory `targetDirectory`.
 * Moving a folder into itself or one of its own descendants would destroy it, and traversal segments are refused
 * outright instead of being normalised away.
 */
export const checkMove = (source: string, targetDirectory: string): MoveCheck => {
    if (hasUnsafeSegments(source) || hasUnsafeSegments(targetDirectory)) {
        return { ok: false, reason: 'That location is not allowed.' };
    }
    const from = normalize(source);
    const to = normalize(targetDirectory);

    if (from === '/') return { ok: false, reason: 'The server root cannot be moved.' };
    if (dirname(from) === to) return { ok: true, noop: true };
    if (isInside(from, to)) return { ok: false, reason: 'A folder cannot be moved into itself.' };

    return { ok: true };
};

/** The path of an entry once `from` has been renamed or moved to `to`; unchanged if it was not affected. */
export const remapPath = (path: string, from: string, to: string): string => {
    if (path === from) return to;

    return path.startsWith(from + '/') ? to + path.slice(from.length) : path;
};

/** "name.ext" -> "name (copy).ext", "name (copy).ext" -> "name (copy 2).ext", and so on, skipping taken names. */
export const copyName = (name: string, taken: Iterable<string>): string => {
    const used = new Set(taken);
    const dot = name.lastIndexOf('.');
    const hasExt = dot > 0;
    const stem = hasExt ? name.slice(0, dot) : name;
    const ext = hasExt ? name.slice(dot) : '';
    const base = stem.replace(/ \(copy(?: \d+)?\)$/, '');

    for (let n = 1; n < 10000; ++n) {
        const candidate = `${base} (copy${n === 1 ? '' : ` ${n}`})${ext}`;
        if (!used.has(candidate)) return candidate;
    }

    return `${base} (copy ${Date.now()})${ext}`;
};

export const parentOf = (path: string): string => dirname(normalize(path));
export const nameOf = (path: string): string => basename(path);
export const childPath = (directory: string, name: string): string => join(normalize(directory), name);

/** The text of a path as the person sees it, with the container root made explicit. */
export const displayPath = (path: string): string =>
    '/home/container' + (normalize(path) === '/' ? '' : normalize(path));

export const DRAG_TYPE = 'application/x-gobia-files';

export interface DragPayload {
    // Directory the entries are currently in.
    directory: string;
    names: string[];
}

export const encodeDrag = (payload: DragPayload): string => JSON.stringify(payload);

export const decodeDrag = (raw: string): DragPayload | null => {
    try {
        const data = JSON.parse(raw);
        if (
            typeof data?.directory === 'string' &&
            Array.isArray(data.names) &&
            data.names.every((n: unknown) => typeof n === 'string')
        ) {
            return data as DragPayload;
        }
    } catch {
        // Not ours.
    }

    return null;
};
