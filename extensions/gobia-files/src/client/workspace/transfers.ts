import { http, httpErrorToHuman } from '@pterodactyl/sdk';
import { useCallback, useRef, useState } from 'react';

export type TransferMode = 'copy' | 'move';
export type Conflict = 'replace' | 'keep' | 'skip';

export interface ItemResult {
    path: string;
    name: string;
    /** `move_incomplete`: copied and verified, but the original is still on the source (nothing was lost). */
    status: 'copied' | 'moved' | 'skipped' | 'partial' | 'failed' | 'move_incomplete';
    bytes: number;
    copied: number;
    skipped: number;
    failed: number;
    reason: string | null;
    destination?: string | null;
}

export interface TransferEnd {
    pane: 'a' | 'b';
    uuid: string;
    name: string;
}

export interface TransferJob {
    id: number;
    mode: TransferMode;
    conflict: Conflict;
    source: TransferEnd;
    destination: TransferEnd;
    directory: string;
    /** Every path asked for, in order. */
    items: string[];
    /** One result per item the Panel has answered for. */
    results: ItemResult[];
    status: 'running' | 'done' | 'cancelled';
    /** A failure that stopped the job (a server that cannot be reached); item failures are in `results`. */
    error: string | null;
    /** What the explorer showed each item to be, so the Panel can skip a listing. */
    kinds: Record<string, 'file' | 'directory'>;
    /** Items whose copy is already verified and only the original is left to remove. */
    resume: string[];
}

interface Response {
    items: ItemResult[];
    bytes: number;
    timings?: Record<string, number>;
}

/** One request per chosen item, so progress is real: the Panel answers when that item is verified at the destination. */
async function sendItem(
    job: Pick<TransferJob, 'mode' | 'conflict' | 'source' | 'destination' | 'directory' | 'kinds' | 'resume'>,
    item: string,
    signal: AbortSignal
): Promise<ItemResult> {
    const response = await http.post<Response>(
        '/api/client/extensions/gobia-files/transfers',
        {
            source: job.source.uuid,
            destination: job.destination.uuid,
            directory: job.directory,
            items: [item],
            mode: job.mode,
            conflict: job.conflict,
            kinds: job.kinds[item] ? { [item]: job.kinds[item] } : undefined,
            resume: job.resume.includes(item) || undefined,
        },
        { timeout: 15 * 60 * 1000, signal }
    );
    const result = response.data.items[0];
    if (!result) throw new Error('The Panel returned no result.');
    return result;
}

export interface TransferHooks {
    /** Called after each item was answered for, so the explorers can refresh what changed. */
    onItem: (job: TransferJob, result: ItemResult) => void;
    onFinish: (job: TransferJob) => void;
}

export function useTransfers(hooks: TransferHooks) {
    const [jobs, setJobs] = useState<TransferJob[]>([]);
    const next = useRef(1);
    const controllers = useRef(new Map<number, AbortController>());
    const callbacks = useRef(hooks);
    callbacks.current = hooks;

    const patch = useCallback((id: number, change: (job: TransferJob) => TransferJob) => {
        setJobs((current) => current.map((job) => (job.id === id ? change(job) : job)));
    }, []);

    const run = useCallback(
        async (start: TransferJob) => {
            const controller = new AbortController();
            controllers.current.set(start.id, controller);
            let latest = start;
            const update = (change: (job: TransferJob) => TransferJob) => {
                latest = change(latest);
                patch(start.id, () => latest);
            };
            for (const item of start.items.filter((path) => !start.results.some((done) => done.path === path))) {
                if (controller.signal.aborted) break;
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const result = await sendItem(start, item, controller.signal);
                    update((job) => ({ ...job, results: [...job.results, result] }));
                    callbacks.current.onItem(latest, result);
                } catch (error) {
                    if (controller.signal.aborted) break;
                    const reason = httpErrorToHuman(error as Error);
                    const name = item.slice(item.lastIndexOf('/') + 1);
                    update((job) => ({
                        ...job,
                        results: [
                            ...job.results,
                            { path: item, name, status: 'failed', bytes: 0, copied: 0, skipped: 0, failed: 1, reason },
                        ],
                    }));
                }
            }
            controllers.current.delete(start.id);
            update((job) => ({ ...job, status: controller.signal.aborted ? 'cancelled' : 'done' }));
            callbacks.current.onFinish(latest);
        },
        [patch]
    );

    const start = useCallback(
        (job: Omit<TransferJob, 'id' | 'results' | 'status' | 'error' | 'resume'>) => {
            const created: TransferJob = {
                ...job,
                id: next.current++,
                results: [],
                status: 'running',
                error: null,
                resume: [],
            };
            setJobs((current) => [...current, created]);
            void run(created);
        },
        [run]
    );

    /** Runs the items that failed (or were never reached) again. */
    const retry = useCallback(
        (id: number) => {
            const job = jobs.find((candidate) => candidate.id === id);
            if (!job || job.status === 'running') return;
            const kept = job.results.filter((result) => ['copied', 'moved', 'skipped'].includes(result.status));
            // An item whose copy was verified only needs its original removed; nothing is copied twice.
            const resume = job.results
                .filter((result) => result.status === 'move_incomplete')
                .map((result) => result.path);
            const again: TransferJob = { ...job, results: kept, status: 'running', error: null, resume };
            patch(id, () => again);
            void run(again);
        },
        [jobs, patch, run]
    );

    const cancel = useCallback((id: number) => controllers.current.get(id)?.abort(), []);
    const clear = useCallback(() => setJobs((current) => current.filter((job) => job.status === 'running')), []);

    return { jobs, start, retry, cancel, clear };
}
