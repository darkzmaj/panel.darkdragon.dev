import { Button, Dialog, toast } from '@pterodactyl/sdk';
import { ChevronDown, ChevronRight, Replace, Search } from 'lucide-react';
import FileTypeIcon from './FileTypeIcon';
import { useRef, useState, type FormEvent } from 'react';
import {
    buildPattern,
    replaceAll,
    replaceHit,
    replacementFor,
    searchWorkspace,
    type FileResult,
    type Hit,
    type SearchOutcome,
} from './search';

export type ReplaceResult = { ok: true; undo?: () => Promise<void> } | { ok: false; reason: string };

interface Props {
    uuid: string;
    /** Text of open tabs, taken when a search starts, so unsaved edits are searched too. */
    buffers: () => Map<string, string>;
    canReplace: boolean;
    onOpen: (path: string, line: number, column: number) => void;
    /** Applies a text change to one file (an open tab or the file on disk) and says whether it went through. */
    onReplace: (result: FileResult, change: (text: string) => string) => Promise<ReplaceResult>;
}

function Flag({ label, title, on, onToggle }: { label: string; title: string; on: boolean; onToggle: () => void }) {
    return (
        <button
            type={'button'}
            className={'gb-search-flag'}
            aria-pressed={on}
            title={title}
            aria-label={title}
            onClick={onToggle}
        >
            {label}
        </button>
    );
}

/** Search and replace across the whole server: files and match counts, line previews, replacement previews. */
export default function SearchPanel({ uuid, buffers, canReplace, onOpen, onReplace }: Props) {
    const [query, setQuery] = useState('');
    const [replacement, setReplacement] = useState('');
    const [showReplace, setShowReplace] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [regex, setRegex] = useState(false);
    const [results, setResults] = useState<FileResult[]>([]);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
    const [running, setRunning] = useState(false);
    const [scanned, setScanned] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [notes, setNotes] = useState<string[]>([]);
    // What the last replacement can undo: one entry per file it changed.
    const [undos, setUndos] = useState<Array<{ path: string; undo: () => Promise<void> }>>([]);
    const run = useRef(0);

    const options = { query, caseSensitive, wholeWord, regex };
    const built = buildPattern(options);
    const pattern = built && 'pattern' in built ? built.pattern : null;
    const total = results.reduce((sum, file) => sum + file.hits.length, 0);

    const search = async (event?: FormEvent) => {
        event?.preventDefault();
        if (built === null) return;
        if ('error' in built) {
            setError(built.error);
            return;
        }
        const mine = ++run.current;
        setError(null);
        setNotes([]);
        setResults([]);
        setOutcome(null);
        setRunning(true);
        setScanned(0);
        const found: FileResult[] = [];
        let queued = false;
        const flush = () => {
            queued = false;
            setResults([...found].sort((a, b) => a.path.localeCompare(b.path)));
        };
        const done = await searchWorkspace({
            uuid,
            pattern: built.pattern,
            buffers: buffers(),
            cancelled: () => run.current !== mine,
            onFile: (file) => {
                found.push(file);
                if (!queued) {
                    queued = true;
                    window.setTimeout(flush, 120);
                }
            },
            onProgress: setScanned,
        });
        if (run.current !== mine) return;
        flush();
        setOutcome(done);
        setRunning(false);
    };

    const replaceFiles = async (files: readonly FileResult[]) => {
        if (pattern === null) return;
        const problems: string[] = [];
        const reverts: Array<{ path: string; undo: () => Promise<void> }> = [];
        let changed = 0;
        for (const file of files) {
            // eslint-disable-next-line no-await-in-loop
            const result = await onReplace(file, (text) => replaceAll(text, pattern, replacement, regex));
            if (result.ok) {
                changed += file.hits.length;
                if (result.undo) reverts.push({ path: file.path, undo: result.undo });
            } else problems.push(`${file.path}: ${result.reason}`);
        }
        setNotes(
            problems.length > 0
                ? [
                      `${changed} ${changed === 1 ? 'match was' : 'matches were'} replaced, ${problems.length} ${problems.length === 1 ? 'file was' : 'files were'} left unchanged:`,
                      ...problems,
                  ]
                : []
        );
        setUndos(reverts);
        if (changed > 0) toast.success(`Replaced ${changed} ${changed === 1 ? 'match' : 'matches'}.`);
        if (problems.length > 0)
            toast.error(`${problems.length} ${problems.length === 1 ? 'file was' : 'files were'} not changed.`);
        void search();
    };

    const undoLast = async () => {
        const failed: string[] = [];
        for (const { path, undo } of undos) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await undo();
            } catch (error) {
                failed.push(`${path}: ${error instanceof Error ? error.message : 'could not be restored'}`);
            }
        }
        setUndos([]);
        setNotes(failed);
        if (failed.length === 0) toast.success('The replacement was undone.');
        void search();
    };

    const replaceOne = async (file: FileResult, hit: Hit) => {
        if (pattern === null) return;
        const result = await onReplace(file, (text) => replaceHit(text, hit, pattern, replacement, regex));
        if (!result.ok) setNotes([`${file.path}: ${result.reason}`]);
        void search();
    };

    const preview = (hit: Hit) =>
        showReplace && canReplace && pattern ? (
            <>
                <del>{hit.match}</del>
                <ins>{replacementFor(hit.match, pattern, replacement, regex)}</ins>
            </>
        ) : (
            <mark>{hit.match}</mark>
        );

    return (
        <div className={'gb-search'}>
            <form className={'gb-search-form'} onSubmit={(event) => void search(event)} role={'search'}>
                <div className={'gb-search-row'}>
                    {canReplace && (
                        <button
                            type={'button'}
                            className={'gb-icon-btn gb-icon-btn-sm'}
                            aria-label={showReplace ? 'Hide replace' : 'Show replace'}
                            aria-expanded={showReplace}
                            onClick={() => setShowReplace((open) => !open)}
                        >
                            {showReplace ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                        </button>
                    )}
                    <input
                        className={'gb-input'}
                        value={query}
                        placeholder={'Search files'}
                        aria-label={'Search query'}
                        autoComplete={'off'}
                        spellCheck={false}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                    <Flag
                        label={'Aa'}
                        title={'Match case'}
                        on={caseSensitive}
                        onToggle={() => setCaseSensitive((on) => !on)}
                    />
                    <Flag label={'ab'} title={'Whole word'} on={wholeWord} onToggle={() => setWholeWord((on) => !on)} />
                    <Flag label={'.*'} title={'Regular expression'} on={regex} onToggle={() => setRegex((on) => !on)} />
                </div>
                {showReplace && canReplace && (
                    <div className={'gb-search-row'}>
                        <input
                            className={'gb-input'}
                            value={replacement}
                            placeholder={'Replace with'}
                            aria-label={'Replace with'}
                            autoComplete={'off'}
                            spellCheck={false}
                            onChange={(event) => setReplacement(event.currentTarget.value)}
                        />
                        <button
                            type={'button'}
                            className={'gb-btn gb-btn-sm'}
                            disabled={running || total === 0}
                            onClick={() => setConfirm(true)}
                        >
                            <Replace aria-hidden /> Replace all
                        </button>
                    </div>
                )}
                <div className={'gb-search-row'}>
                    <button
                        type={'submit'}
                        className={'gb-btn gb-btn-primary gb-btn-sm'}
                        disabled={running || query === ''}
                    >
                        <Search aria-hidden /> {running ? 'Searching…' : 'Search'}
                    </button>
                    {running && (
                        <button
                            type={'button'}
                            className={'gb-btn gb-btn-sm'}
                            onClick={() => ((run.current += 1), setRunning(false))}
                        >
                            Stop
                        </button>
                    )}
                </div>
            </form>

            {undos.length > 0 && (
                <div className={'gb-search-summary'}>
                    <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => void undoLast()}>
                        Undo the last replacement ({undos.length} {undos.length === 1 ? 'file' : 'files'})
                    </button>
                </div>
            )}
            <div className={'gb-search-summary'} role={'status'} aria-live={'polite'}>
                {error && <span style={{ color: 'rgb(var(--gb-danger))' }}>{error}</span>}
                {running && <span>Searching… {scanned} files read</span>}
                {!running && outcome && (
                    <span>
                        {total === 0
                            ? 'No results'
                            : `${total} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'file' : 'files'}`}
                        {outcome.skippedBinary > 0 && ` · ${outcome.skippedBinary} binary or large skipped`}
                        {outcome.truncated && ' · results were limited'}
                    </span>
                )}
            </div>

            <div className={'gb-search-results'}>
                {notes.map((note) => (
                    <p
                        key={note}
                        role={'alert'}
                        className={'gb-badge gb-badge-danger'}
                        style={{ height: 'auto', margin: '4px 6px', padding: '6px 10px', whiteSpace: 'normal' }}
                    >
                        {note}
                    </p>
                ))}
                {results.map((file) => {
                    const closed = collapsed.has(file.path);
                    return (
                        <div key={file.path}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <button
                                    type={'button'}
                                    className={'gb-search-file'}
                                    aria-expanded={!closed}
                                    title={file.path}
                                    onClick={() =>
                                        setCollapsed((current) => {
                                            const next = new Set(current);
                                            if (!next.delete(file.path)) next.add(file.path);
                                            return next;
                                        })
                                    }
                                >
                                    {closed ? (
                                        <ChevronRight size={14} aria-hidden />
                                    ) : (
                                        <ChevronDown size={14} aria-hidden />
                                    )}
                                    <FileTypeIcon name={file.path.slice(file.path.lastIndexOf('/') + 1)} size={14} />
                                    <span
                                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    >
                                        {file.path.slice(1)}
                                    </span>
                                    <small>{file.hits.length}</small>
                                </button>
                                {showReplace && canReplace && (
                                    <button
                                        type={'button'}
                                        className={'gb-icon-btn gb-icon-btn-sm'}
                                        aria-label={`Replace all in ${file.path}`}
                                        title={'Replace all in this file'}
                                        onClick={() => void replaceFiles([file])}
                                    >
                                        <Replace aria-hidden />
                                    </button>
                                )}
                            </div>
                            {!closed &&
                                file.hits.map((hit) => (
                                    <div
                                        key={`${hit.line}:${hit.column}`}
                                        style={{ display: 'flex', alignItems: 'center' }}
                                    >
                                        <button
                                            type={'button'}
                                            className={'gb-search-hit'}
                                            onClick={() => onOpen(file.path, hit.line, hit.column)}
                                        >
                                            <span className={'gb-muted'}>{hit.line}: </span>
                                            {hit.before}
                                            {preview(hit)}
                                            {hit.after}
                                        </button>
                                        {showReplace && canReplace && (
                                            <button
                                                type={'button'}
                                                className={'gb-icon-btn gb-icon-btn-sm'}
                                                aria-label={`Replace match on line ${hit.line} of ${file.path}`}
                                                title={'Replace this match'}
                                                onClick={() => void replaceOne(file, hit)}
                                            >
                                                <Replace aria-hidden />
                                            </button>
                                        )}
                                    </div>
                                ))}
                        </div>
                    );
                })}
            </div>

            {confirm && (
                <Dialog
                    open
                    onClose={() => setConfirm(false)}
                    title={`Replace ${total} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'file' : 'files'}?`}
                    description={`“${query}” becomes “${replacement}”. Open files are changed in their tab and stay unsaved; other files are written now. Files that changed since the search, or that would become invalid JSON, YAML, TOML or XML, are left alone.`}
                >
                    <ul
                        className={'gb-subcard'}
                        style={{
                            listStyle: 'none',
                            margin: 0,
                            padding: 8,
                            maxHeight: 200,
                            overflowY: 'auto',
                            fontSize: 13,
                        }}
                    >
                        {results.map((file) => (
                            <li key={file.path} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.path}</span>
                                <span className={'gb-muted'}>{file.hits.length}</span>
                            </li>
                        ))}
                    </ul>
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setConfirm(false)}>
                            Cancel
                        </Button.Text>
                        <Button
                            type={'button'}
                            color={'primary'}
                            onClick={() => {
                                setConfirm(false);
                                void replaceFiles(results);
                            }}
                        >
                            Replace
                        </Button>
                    </Dialog.Footer>
                </Dialog>
            )}
        </div>
    );
}
