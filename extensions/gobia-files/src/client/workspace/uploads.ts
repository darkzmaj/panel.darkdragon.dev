import { http, httpErrorToHuman } from '@pterodactyl/sdk';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { join } from './paths';

export interface UploadItem {
    id: number;
    file: File;
    /** Absolute server directory the file is written to. */
    directory: string;
    loaded: number;
    status: 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';
    error: string | null;
}

type UploadAction =
    | { type: 'add'; items: UploadItem[] }
    | { type: 'update'; id: number; change: Partial<UploadItem> }
    | { type: 'remove'; id: number }
    | { type: 'clearFinished' };

export function uploadReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
    switch (action.type) {
        case 'add':
            return [...state, ...action.items];
        case 'update':
            return state.map((item) => (item.id === action.id ? { ...item, ...action.change } : item));
        case 'remove':
            return state.filter((item) => item.id !== action.id);
        case 'clearFinished':
            return state.filter((item) => item.status === 'queued' || item.status === 'uploading');
    }
}

/** A file with the folder it sits in, relative to the place it was dropped or chosen. */
export interface PickedFile {
    file: File;
    /** Folder path without leading or trailing slash, empty for the top level. */
    folder: string;
}

const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: FileSystemEntry, folder: string, into: PickedFile[]): Promise<void> {
    if (entry.isFile) {
        into.push({ file: await fileOf(entry as FileSystemFileEntry), folder });
        return;
    }
    const inner = folder === '' ? entry.name : `${folder}/${entry.name}`;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most 100 entries per call; keep reading until it returns none.
    for (let batch = await readEntries(reader); batch.length > 0; batch = await readEntries(reader)) {
        for (const child of batch) await walk(child, inner, into);
    }
}

/** Files and whole folders from a drop. Folder structure is kept through `folder`. */
export async function pickedFromDrop(transfer: DataTransfer): Promise<PickedFile[]> {
    const picked: PickedFile[] = [];
    // Entries must be collected synchronously: the DataTransfer is emptied once the event handler returns.
    const entries = Array.from(transfer.items)
        .map((item) => item.webkitGetAsEntry())
        .filter((entry): entry is FileSystemEntry => entry !== null);
    if (entries.length === 0) {
        return Array.from(transfer.files).map((file) => ({ file, folder: '' }));
    }
    for (const entry of entries) await walk(entry, '', picked);
    return picked;
}

/** Files from an `<input type=file webkitdirectory>` or a plain file input. */
export function pickedFromInput(files: FileList): PickedFile[] {
    return Array.from(files).map((file) => {
        const parts = file.webkitRelativePath.split('/').slice(0, -1);
        return { file, folder: parts.join('/') };
    });
}

/** Every folder that must exist before the files can be written, parents first. */
export function foldersToCreate(picked: readonly PickedFile[]): string[] {
    const folders = new Set<string>();
    for (const { folder } of picked) {
        const parts = folder.split('/').filter((part) => part !== '');
        for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join('/'));
    }
    return [...folders].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

const base = (uuid: string) => `/api/client/servers/${uuid}/files`;

async function ensureFolders(uuid: string, root: string, folders: readonly string[]): Promise<void> {
    for (const folder of folders) {
        const slash = folder.lastIndexOf('/');
        const parent = slash < 0 ? root : join(root, folder.slice(0, slash));
        try {
            await http.post(`${base(uuid)}/create-folder`, { root: parent, name: folder.slice(slash + 1) });
        } catch {
            // An existing folder is fine; a real failure surfaces when the first file inside it is uploaded.
        }
    }
}

function send(url: string, directory: string, file: File, onProgress: (loaded: number) => void, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        const target = new URL(url);
        target.searchParams.set('directory', directory);
        request.open('POST', target.toString());
        request.upload.onprogress = (event) => onProgress(event.loaded);
        request.onload = () =>
            request.status >= 200 && request.status < 300
                ? resolve()
                : reject(new Error(`Upload failed (${request.status}).`));
        request.onerror = () => reject(new Error('The node could not be reached.'));
        request.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
        signal.addEventListener('abort', () => request.abort(), { once: true });
        const body = new FormData();
        body.append('files', file);
        request.send(body);
    });
}

const CONCURRENCY = 3;
let sequence = 0;

/** Queue with progress, cancel and retry. `onSettled` runs once the queue goes idle, to refresh listings. */
export function useUploadQueue(uuid: string, onSettled: () => void) {
    const [items, dispatch] = useReducer(uploadReducer, []);
    const latest = useRef(items);
    const controllers = useRef(new Map<number, AbortController>());
    const active = useRef(0);
    const settled = useRef(onSettled);

    useEffect(() => {
        latest.current = items;
        settled.current = onSettled;
    });
    useEffect(() => {
        const open = controllers.current;
        return () => open.forEach((controller) => controller.abort());
    }, []);

    const pump = useCallback(() => {
        while (active.current < CONCURRENCY) {
            const next = latest.current.find((item) => item.status === 'queued');
            if (!next) break;
            // Marked synchronously so a second pump call cannot start the same item.
            latest.current = latest.current.map((item) =>
                item.id === next.id ? { ...item, status: 'uploading' } : item
            );
            active.current++;
            const controller = new AbortController();
            controllers.current.set(next.id, controller);
            dispatch({ type: 'update', id: next.id, change: { status: 'uploading', loaded: 0, error: null } });
            void (async () => {
                try {
                    const response = await http.get<{ attributes: { url: string } }>(`${base(uuid)}/upload`);
                    await send(
                        response.data.attributes.url,
                        next.directory,
                        next.file,
                        (loaded) => dispatch({ type: 'update', id: next.id, change: { loaded } }),
                        controller.signal
                    );
                    dispatch({ type: 'update', id: next.id, change: { status: 'done', loaded: next.file.size } });
                } catch (error) {
                    const cancelled = controller.signal.aborted;
                    dispatch({
                        type: 'update',
                        id: next.id,
                        change: {
                            status: cancelled ? 'cancelled' : 'failed',
                            error: cancelled ? null : httpErrorToHuman(error as Error),
                        },
                    });
                } finally {
                    controllers.current.delete(next.id);
                    active.current--;
                    if (active.current === 0 && !latest.current.some((item) => item.status === 'queued')) {
                        settled.current();
                    }
                    pump();
                }
            })();
        }
    }, [uuid]);

    const add = useCallback(
        async (root: string, picked: readonly PickedFile[]) => {
            await ensureFolders(uuid, root, foldersToCreate(picked));
            const queued: UploadItem[] = picked.map(({ file, folder }) => ({
                id: ++sequence,
                file,
                directory: folder === '' ? root : join(root, folder),
                loaded: 0,
                status: 'queued',
                error: null,
            }));
            latest.current = [...latest.current, ...queued];
            dispatch({ type: 'add', items: queued });
            pump();
        },
        [uuid, pump]
    );

    const cancel = useCallback((id: number) => {
        const controller = controllers.current.get(id);
        if (controller) {
            controller.abort();
            return;
        }
        latest.current = latest.current.map((item) => (item.id === id ? { ...item, status: 'cancelled' } : item));
        dispatch({ type: 'update', id, change: { status: 'cancelled' } });
    }, []);

    const retry = useCallback(
        (id: number) => {
            latest.current = latest.current.map((item) => (item.id === id ? { ...item, status: 'queued' } : item));
            dispatch({ type: 'update', id, change: { status: 'queued', loaded: 0, error: null } });
            pump();
        },
        [pump]
    );

    const clearFinished = useCallback(() => dispatch({ type: 'clearFinished' }), []);

    return { items, add, cancel, retry, clearFinished };
}
