import axios from 'axios';
import { dirname, join } from 'pathe';
import getFileUploadUrl from '@/api/server/files/getFileUploadUrl';
import createDirectory from '@/api/server/files/createDirectory';
import { httpErrorToHuman } from '@/api/http';
import { hasUnsafeSegments, normalize } from '@/components/server/files/fileOps';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
    id: number;
    uuid: string;
    // What the person sees: the path relative to where they dropped it, e.g. "world/region/r.0.0.mca".
    label: string;
    directory: string;
    file: File;
    status: UploadStatus;
    loaded: number;
    total: number;
    // Bytes per second, smoothed.
    speed: number;
    error?: string;
}

export interface DroppedFile {
    file: File;
    // Path below the drop target, using "/" and ending in the file name.
    relativePath: string;
}

export interface UploadPlan {
    directories: string[];
    files: Array<{ file: File; directory: string; label: string }>;
}

const CONCURRENCY = 3;

/**
 * Turns dropped or picked files into what has to happen on the server: which folders must exist (parents first) and
 * which directory each file goes into. Paths that try to leave the target are rejected.
 */
export const planUploads = (
    baseDirectory: string,
    dropped: DroppedFile[],
    extraDirectories: string[] = []
): UploadPlan => {
    const base = normalize(baseDirectory);
    const dirs = new Set<string>();
    const files: UploadPlan['files'] = [];

    const addAncestors = (relative: string) => {
        const parts = relative.split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; ++i) dirs.add(join(base, parts.slice(0, i).join('/')));
    };

    for (const { file, relativePath } of dropped) {
        if (hasUnsafeSegments(relativePath)) continue;
        const clean = relativePath.split('/').filter(Boolean).join('/');
        if (!clean) continue;
        const folder = dirname(clean);
        if (folder !== '.') addAncestors(folder);
        files.push({ file, directory: folder === '.' ? base : join(base, folder), label: clean });
    }
    for (const dir of extraDirectories) {
        if (!hasUnsafeSegments(dir)) addAncestors(dir);
    }

    return {
        directories: Array.from(dirs).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
        files,
    };
};

// --- reading a drop ------------------------------------------------------------------------------------------------

const readAll = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        const next = () =>
            reader.readEntries((batch) => {
                if (!batch.length) return resolve(all);
                all.push(...batch);
                next();
            }, reject);
        next();
    });

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

/**
 * Walks everything in a drop, including folders and their contents. The entries have to be taken from the event
 * synchronously because the browser invalidates the DataTransfer as soon as the handler yields.
 */
export const collectDropped = async (dt: DataTransfer): Promise<{ files: DroppedFile[]; directories: string[] }> => {
    const entries = Array.from(dt.items || [])
        .map((item) => (item.kind === 'file' && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
        .filter((e): e is FileSystemEntry => !!e);
    const plain = Array.from(dt.files || []);

    if (!entries.length) {
        return { files: plain.map((file) => ({ file, relativePath: file.name })), directories: [] };
    }

    const files: DroppedFile[] = [];
    const directories: string[] = [];
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
        if (entry.isFile) {
            files.push({ file: await fileOf(entry as FileSystemFileEntry), relativePath: prefix + entry.name });

            return;
        }
        directories.push(prefix + entry.name);
        const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
        for (const child of children) await walk(child, prefix + entry.name + '/');
    };
    for (const entry of entries) await walk(entry, '');

    return { files, directories };
};

/** Files picked with an `<input type=file>`; a folder pick carries the relative path in `webkitRelativePath`. */
export const fromInput = (list: FileList): DroppedFile[] =>
    Array.from(list).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));

// --- the queue -----------------------------------------------------------------------------------------------------

type Listener = () => void;
type Completed = (uuid: string, directory: string) => void;

let nextId = 1;
let items: UploadItem[] = [];
const controllers = new Map<number, AbortController>();
const batches = new Map<number, Promise<void>>();
const listeners = new Set<Listener>();
const completedListeners = new Set<Completed>();
let running = 0;

const emit = () => listeners.forEach((l) => l());
const update = (id: number, changes: Partial<UploadItem>) => {
    items = items.map((i) => (i.id === id ? { ...i, ...changes } : i));
    emit();
};

export const getUploads = (): UploadItem[] => items;
export const subscribeUploads = (l: Listener) => {
    listeners.add(l);

    return () => {
        listeners.delete(l);
    };
};
export const onUploadCompleted = (l: Completed) => {
    completedListeners.add(l);

    return () => {
        completedListeners.delete(l);
    };
};

const run = async (item: UploadItem) => {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    update(item.id, { status: 'uploading', loaded: 0, speed: 0, error: undefined });

    let lastLoaded = 0;
    let lastTime = Date.now();
    let speed = 0;
    try {
        await batches.get(item.id);
        if (controller.signal.aborted) throw new axios.Cancel('cancelled');
        const url = await getFileUploadUrl(item.uuid);
        await axios.post(
            url,
            { files: item.file },
            {
                signal: controller.signal,
                headers: { 'Content-Type': 'multipart/form-data' },
                params: { directory: item.directory },
                onUploadProgress: (e) => {
                    const now = Date.now();
                    const elapsed = (now - lastTime) / 1000;
                    if (elapsed >= 0.25) {
                        const instant = (e.loaded - lastLoaded) / elapsed;
                        speed = speed ? speed * 0.6 + instant * 0.4 : instant;
                        lastLoaded = e.loaded;
                        lastTime = now;
                    }
                    update(item.id, { loaded: e.loaded, total: e.total || item.total, speed });
                },
            }
        );
        update(item.id, {
            status: 'done',
            loaded: items.find((i) => i.id === item.id)?.total ?? item.total,
            speed: 0,
        });
        completedListeners.forEach((l) => l(item.uuid, item.directory));
    } catch (error) {
        if (axios.isCancel(error) || controller.signal.aborted) {
            update(item.id, { status: 'cancelled', speed: 0 });
        } else {
            update(item.id, { status: 'failed', speed: 0, error: httpErrorToHuman(error) });
        }
    } finally {
        controllers.delete(item.id);
        running--;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        pump();
    }
};

const pump = () => {
    while (running < CONCURRENCY) {
        const next = items.find((i) => i.status === 'queued');
        if (!next) return;
        running++;
        void run(next);
    }
};

/** Adds a batch to the queue. Folders are created first (parents before children), then the files upload in parallel. */
export const enqueue = (uuid: string, plan: UploadPlan): number => {
    if (!plan.files.length && !plan.directories.length) return 0;

    const prepare = (async () => {
        for (const directory of plan.directories) {
            try {
                await createDirectory(uuid, dirname(directory), directory.split('/').pop() as string);
            } catch {
                // It most likely exists already; if it really cannot be created, the uploads into it report the error.
            }
        }
    })();

    const added: UploadItem[] = plan.files.map(({ file, directory, label }) => ({
        id: nextId++,
        uuid,
        label,
        directory,
        file,
        status: 'queued',
        loaded: 0,
        total: file.size,
        speed: 0,
    }));
    added.forEach((i) => batches.set(i.id, prepare));
    items = [...items, ...added];
    emit();
    if (!added.length) prepare.then(() => completedListeners.forEach((l) => l(uuid, dirname(plan.directories[0]))));
    pump();

    return added.length;
};

export const cancelUpload = (id: number) => {
    const controller = controllers.get(id);
    if (controller) return controller.abort();
    if (items.find((i) => i.id === id)?.status === 'queued') update(id, { status: 'cancelled' });
};

export const retryUpload = (id: number) => {
    const item = items.find((i) => i.id === id);
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return;
    update(id, { status: 'queued', loaded: 0, speed: 0, error: undefined });
    pump();
};

export const cancelAllUploads = () =>
    items.forEach((i) => (i.status === 'queued' || i.status === 'uploading') && cancelUpload(i.id));

export const clearFinishedUploads = () => {
    items = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
    emit();
};

/** Test helper: forget everything. */
export const resetUploads = () => {
    controllers.forEach((c) => c.abort());
    controllers.clear();
    batches.clear();
    items = [];
    running = 0;
    emit();
};
