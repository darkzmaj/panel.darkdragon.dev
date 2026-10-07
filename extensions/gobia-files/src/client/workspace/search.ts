import { listDirectory, readFile, type TreeEntry } from './api';
import { MAX_EDIT_BYTES } from './paths';

export interface SearchOptions {
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
}

export interface Hit {
    /** 1 based. */
    line: number;
    column: number;
    length: number;
    /** The line, shortened around the match for display. */
    before: string;
    match: string;
    after: string;
}

export interface FileResult {
    path: string;
    hits: Hit[];
    /** Modification time the file had when it was read; a later change blocks replacing. */
    modifiedAt: string;
    /** Whether the text came from an open, possibly unsaved, editor tab rather than from disk. */
    buffer: boolean;
}

export interface SearchOutcome {
    files: number;
    matches: number;
    scanned: number;
    skippedBinary: number;
    truncated: boolean;
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);
const BINARY_TYPE = /^(image|audio|video|font)\/|zip|gzip|tar|octet-stream|java-archive|x-7z|rar|pdf|executable|sharedlib/i;
const MAX_FILES = 4000;
const MAX_MATCHES = 5000;
const CONTEXT = 60;

/** The matcher for the options, or an error message when the pattern is not valid. */
export type Built = { pattern: RegExp } | { error: string } | null;

export function buildPattern(options: SearchOptions): Built {
    if (options.query === '') return null;
    const source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return { pattern: new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.caseSensitive ? 'g' : 'gi') };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Invalid pattern' };
    }
}

/** Every non empty match, line by line (patterns do not span lines). */
export function findHits(text: string, pattern: RegExp): Hit[] {
    const hits: Hit[] = [];
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const line = (lines[index] ?? '').replace(/\r$/, '');
        pattern.lastIndex = 0;
        for (let found = pattern.exec(line); found; found = pattern.exec(line)) {
            if (found[0] === '') {
                pattern.lastIndex++;
                continue;
            }
            const start = found.index;
            const from = Math.max(0, start - CONTEXT);
            hits.push({
                line: index + 1,
                column: start + 1,
                length: found[0].length,
                before: (from > 0 ? '…' : '') + line.slice(from, start).trimStart(),
                match: found[0],
                after: line.slice(start + found[0].length, start + found[0].length + CONTEXT),
            });
        }
    }
    return hits;
}

/** What `match` would become; regex searches honour `$1` style groups. */
export function replacementFor(match: string, pattern: RegExp, replacement: string, regex: boolean): string {
    const single = new RegExp(pattern.source, pattern.flags.replace('g', ''));
    return regex ? match.replace(single, replacement) : replacement;
}

/** The text with every match replaced. */
export function replaceAll(text: string, pattern: RegExp, replacement: string, regex: boolean): string {
    return text
        .split('\n')
        .map((line) => {
            pattern.lastIndex = 0;
            return regex ? line.replace(pattern, replacement) : line.replace(pattern, () => replacement);
        })
        .join('\n');
}

/** The text with only the match `hit` points at replaced. */
export function replaceHit(text: string, hit: Hit, pattern: RegExp, replacement: string, regex: boolean): string {
    const lines = text.split('\n');
    const line = lines[hit.line - 1];
    if (line === undefined) return text;
    const chosen = replacementFor(line.slice(hit.column - 1, hit.column - 1 + hit.length), pattern, replacement, regex);
    lines[hit.line - 1] = line.slice(0, hit.column - 1) + chosen + line.slice(hit.column - 1 + hit.length);
    return lines.join('\n');
}

export interface SearchRun {
    uuid: string;
    pattern: RegExp;
    /** Text of open editor tabs, which wins over what is on disk. */
    buffers: ReadonlyMap<string, string>;
    cancelled: () => boolean;
    onFile: (result: FileResult) => void;
    onProgress: (scanned: number) => void;
}

const isBinary = (entry: TreeEntry) => entry.size > MAX_EDIT_BYTES || BINARY_TYPE.test(entry.mimetype);

/**
 * Walks the server's files from the root, a few directories at a time, and reports every text file that matches.
 * Binary files, files above the editing limit, and dependency or VCS folders are never opened.
 */
export async function searchWorkspace(run: SearchRun): Promise<SearchOutcome> {
    let walkers = 4;
    const outcome: SearchOutcome = { files: 0, matches: 0, scanned: 0, skippedBinary: 0, truncated: false };
    const directories: string[] = ['/'];
    const files: TreeEntry[] = [];

    const worker = async () => {
        while (!run.cancelled() && !outcome.truncated) {
            const directory = directories.shift();
            if (directory === undefined) return;
            try {
                // eslint-disable-next-line no-await-in-loop
                const items = await listDirectory(run.uuid, directory);
                for (const entry of items) {
                    if (entry.directory) {
                        if (!SKIPPED_DIRECTORIES.has(entry.name)) directories.push(entry.path);
                    } else if (isBinary(entry)) outcome.skippedBinary++;
                    else files.push(entry);
                }
            } catch {
                // An unreadable folder is skipped, the rest of the search goes on.
            }
        }
    };

    const reader = async () => {
        for (;;) {
            if (run.cancelled() || outcome.truncated) return;
            const entry = files.shift();
            if (!entry) {
                if (directories.length === 0 && walkers === 0) return;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => setTimeout(resolve, 15));
                continue;
            }
            if (outcome.scanned >= MAX_FILES) {
                outcome.truncated = true;
                return;
            }
            outcome.scanned++;
            run.onProgress(outcome.scanned);
            try {
                const buffer = run.buffers.get(entry.path);
                // eslint-disable-next-line no-await-in-loop
                const text = buffer ?? (await readFile(run.uuid, entry.path));
                if (text.includes('\0')) {
                    outcome.skippedBinary++;
                    continue;
                }
                const hits = findHits(text, run.pattern);
                if (hits.length === 0) continue;
                outcome.files++;
                outcome.matches += hits.length;
                run.onFile({ path: entry.path, hits, modifiedAt: entry.modifiedAt, buffer: buffer !== undefined });
                if (outcome.matches >= MAX_MATCHES) outcome.truncated = true;
            } catch {
                // Unreadable (permissions, vanished): not a match.
            }
        }
    };

    await Promise.all([
        ...Array.from({ length: 4 }, () =>
            worker().finally(() => {
                walkers--;
            })
        ),
        ...Array.from({ length: 6 }, reader),
    ]);
    return outcome;
}
