import { RotateCw, X } from 'lucide-react';
import FileTypeIcon from './FileTypeIcon';
import type { ItemResult, TransferJob } from './transfers';

interface Props {
    jobs: readonly TransferJob[];
    onCancel: (id: number) => void;
    onRetry: (id: number) => void;
    onClear: () => void;
}

const VERB = { copy: 'Copying', move: 'Moving' } as const;
const DONE = { copy: 'Copied', move: 'Moved' } as const;

const resultText = (result: ItemResult): string => {
    switch (result.status) {
        case 'copied':
        case 'moved':
            return 'Done';
        case 'skipped':
            return result.reason ?? 'Skipped';
        case 'partial':
            return `Some files were not transferred: ${result.reason ?? ''}`;
        case 'failed':
            return result.reason ?? 'Failed';
    }
};

/**
 * The transfers between the two servers: who sends to whom, how many items are verified at the destination, and why
 * anything failed. Progress counts items the Panel has confirmed; there is no invented percentage.
 */
export default function TransferPanel({ jobs, onCancel, onRetry, onClear }: Props) {
    if (jobs.length === 0) return null;
    const finished = jobs.every((job) => job.status !== 'running');

    return (
        <section aria-label={'Transfers between servers'} className={'gb-transfers'}>
            {jobs.map((job) => {
                const failed = job.results.filter(
                    (result) => result.status === 'failed' || result.status === 'partial'
                );
                const verb = job.status === 'running' ? VERB[job.mode] : DONE[job.mode];
                const title =
                    job.items.length === 1
                        ? job.items[0]?.slice((job.items[0]?.lastIndexOf('/') ?? 0) + 1)
                        : `${job.items.length} items`;

                return (
                    <div key={job.id} className={'gb-transfer'} data-status={job.status}>
                        <div className={'gb-transfer-head'}>
                            <strong>
                                {verb} {title}
                            </strong>
                            <span className={'gb-muted'}>
                                {job.source.name} → {job.destination.name}
                                {job.directory !== '/' ? ` ${job.directory}` : ''}
                            </span>
                            <span className={'gb-editor-spacer'} />
                            <span className={'gb-muted'} aria-live={'polite'}>
                                {job.status === 'cancelled'
                                    ? 'Cancelled'
                                    : `${job.results.length} of ${job.items.length} verified`}
                            </span>
                            {job.status === 'running' ? (
                                <button
                                    type={'button'}
                                    className={'gb-icon-btn gb-icon-btn-sm'}
                                    aria-label={`Cancel transfer of ${title}`}
                                    onClick={() => onCancel(job.id)}
                                >
                                    <X aria-hidden />
                                </button>
                            ) : (
                                (failed.length > 0 || job.status === 'cancelled') && (
                                    <button
                                        type={'button'}
                                        className={'gb-icon-btn gb-icon-btn-sm'}
                                        aria-label={`Retry transfer of ${title}`}
                                        onClick={() => onRetry(job.id)}
                                    >
                                        <RotateCw aria-hidden />
                                    </button>
                                )
                            )}
                        </div>
                        <progress
                            max={Math.max(job.items.length, 1)}
                            value={job.results.length}
                            aria-label={`${verb} ${title}`}
                            className={'gb-transfer-bar'}
                        />
                        {job.results.length > 0 && (
                            <ul className={'gb-transfer-list'}>
                                {job.results.map((result) => (
                                    <li key={result.path} className={result.status === 'failed' ? 'failed' : undefined}>
                                        <FileTypeIcon name={result.name} size={14} folder={false} />
                                        <span className={'gb-transfer-name'}>{result.name}</span>
                                        <span
                                            role={result.status === 'failed' ? 'alert' : undefined}
                                            className={result.status === 'failed' ? 'gb-transfer-error' : 'gb-muted'}
                                        >
                                            {resultText(result)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })}
            {finished && (
                <button type={'button'} onClick={onClear} className={'gb-link-button'}>
                    Clear list
                </button>
            )}
        </section>
    );
}
