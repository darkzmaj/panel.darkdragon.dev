import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, CloudUpload, RotateCw, X } from 'lucide-react';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { bytesToString } from '@/lib/formatters';
import { displayPath } from '@/components/server/files/fileOps';
import {
    cancelAllUploads,
    cancelUpload,
    clearFinishedUploads,
    collectDropped,
    enqueue,
    fromInput,
    getUploads,
    planUploads,
    retryUpload,
    subscribeUploads,
    UploadItem,
} from '@/components/server/files/uploadQueue';

export const useUploads = (): UploadItem[] => {
    const [items, setItems] = useState(getUploads);
    useEffect(() => {
        setItems(getUploads());

        return subscribeUploads(() => setItems(getUploads()));
    }, []);

    return items;
};

/** Reads whatever was dropped (files and whole folders) and queues it for upload into `directory`. */
export const uploadDropped = async (uuid: string, data: DataTransfer, directory: string): Promise<number> => {
    const { files, directories } = await collectDropped(data);

    return enqueue(uuid, planUploads(directory, files, directories));
};

export const uploadPicked = (uuid: string, list: FileList, directory: string): number =>
    enqueue(uuid, planUploads(directory, fromInput(list)));

const rate = (bytesPerSecond: number) => (bytesPerSecond > 0 ? `${bytesToString(bytesPerSecond)}/s` : '');

const Row = ({ item }: { item: UploadItem }) => {
    const percent = item.total
        ? Math.min(100, Math.round((item.loaded / item.total) * 100))
        : item.status === 'done'
        ? 100
        : 0;

    return (
        <li className={'gb-upload-row'} data-status={item.status}>
            <div className={'gb-upload-main'}>
                <span className={'gb-upload-name'} title={`${displayPath(item.directory)}/${item.file.name}`}>
                    {item.label}
                </span>
                <span className={'gb-upload-meta'}>
                    {item.status === 'queued' && 'Waiting'}
                    {item.status === 'uploading' &&
                        `${percent}% · ${bytesToString(item.loaded)} of ${bytesToString(item.total)}${
                            item.speed ? ' · ' + rate(item.speed) : ''
                        }`}
                    {item.status === 'done' && `Uploaded · ${bytesToString(item.total)}`}
                    {item.status === 'cancelled' && 'Cancelled'}
                    {item.status === 'failed' && (item.error || 'Failed')}
                </span>
                <div
                    className={'gb-progress'}
                    role={'progressbar'}
                    aria-label={`Uploading ${item.label}`}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <div style={{ width: `${percent}%` }} />
                </div>
            </div>
            {item.status === 'done' && <Check className={'gb-upload-ok'} aria-label={'Done'} />}
            {(item.status === 'queued' || item.status === 'uploading') && (
                <button
                    type={'button'}
                    className={'gb-icon-btn gb-icon-btn-sm'}
                    aria-label={`Cancel ${item.label}`}
                    onClick={() => cancelUpload(item.id)}
                >
                    <X aria-hidden />
                </button>
            )}
            {(item.status === 'failed' || item.status === 'cancelled') && (
                <button
                    type={'button'}
                    className={'gb-icon-btn gb-icon-btn-sm'}
                    aria-label={`Retry ${item.label}`}
                    onClick={() => retryUpload(item.id)}
                >
                    <RotateCw aria-hidden />
                </button>
            )}
        </li>
    );
};

/** The list of uploads in progress: progress, speed, cancel and retry. Hidden when nothing has been queued. */
export const UploadPanel = () => {
    const items = useUploads();
    const [collapsed, setCollapsed] = useState(false);
    if (!items.length) return null;

    const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
    const failed = items.filter((i) => i.status === 'failed').length;
    const done = items.filter((i) => i.status === 'done').length;
    const loaded = items.reduce((n, i) => n + (i.status === 'uploading' ? i.loaded : 0), 0);
    const total = items.reduce((n, i) => n + (i.status === 'uploading' ? i.total : 0), 0);
    const speed = items.reduce((n, i) => n + (i.status === 'uploading' ? i.speed : 0), 0);

    return (
        <section className={'gb-upload-panel'} aria-label={'Uploads'}>
            <header className={'gb-upload-head'}>
                <CloudUpload aria-hidden />
                <div role={'status'} aria-live={'polite'}>
                    <strong>
                        {active.length
                            ? `Uploading ${active.length} file${active.length === 1 ? '' : 's'}`
                            : failed
                            ? `${failed} upload${failed === 1 ? '' : 's'} failed`
                            : `${done} upload${done === 1 ? '' : 's'} complete`}
                    </strong>
                    {active.length > 0 && total > 0 && (
                        <span>
                            {bytesToString(loaded)} of {bytesToString(total)}
                            {speed ? ` · ${rate(speed)}` : ''}
                        </span>
                    )}
                </div>
                <button
                    type={'button'}
                    className={'gb-icon-btn gb-icon-btn-sm'}
                    aria-label={collapsed ? 'Show uploads' : 'Hide uploads'}
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsed((v) => !v)}
                >
                    {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                </button>
            </header>
            {!collapsed && (
                <>
                    <ul className={'gb-upload-list'}>
                        {items.map((item) => (
                            <Row key={item.id} item={item} />
                        ))}
                    </ul>
                    <footer className={'gb-upload-foot'}>
                        {active.length > 0 && (
                            <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={cancelAllUploads}>
                                Cancel all
                            </button>
                        )}
                        <button
                            type={'button'}
                            className={'gb-btn gb-btn-sm gb-btn-ghost'}
                            onClick={clearFinishedUploads}
                        >
                            Clear finished
                        </button>
                    </footer>
                </>
            )}
        </section>
    );
};

/**
 * Shows an overlay while files from the operating system are dragged over the page and queues them when dropped.
 * Folders can take drops of their own (they stop the event), so this only receives what lands anywhere else.
 */
export const UploadDropZone = ({ uuid, directory, enabled }: { uuid: string; directory: string; enabled: boolean }) => {
    const [visible, setVisible] = useState(false);
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);

    useEffect(() => {
        if (!enabled) return undefined;
        let depth = 0;
        const hasFiles = (e: DragEvent) =>
            Array.from(e.dataTransfer?.types || []).some((t) => t.toLowerCase() === 'files');

        const enter = (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth++;
            setVisible(true);
        };
        const over = (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        };
        const leave = (e: DragEvent) => {
            if (!hasFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) setVisible(false);
        };
        const drop = (e: DragEvent) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth = 0;
            setVisible(false);
            if (e.dataTransfer) {
                uploadDropped(uuid, e.dataTransfer, directory).catch(() =>
                    toast({ type: 'error', message: 'Could not read the dropped files.' })
                );
            }
        };
        const cancel = () => {
            depth = 0;
            setVisible(false);
        };
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && cancel();

        window.addEventListener('dragenter', enter);
        window.addEventListener('dragover', over);
        window.addEventListener('dragleave', leave);
        window.addEventListener('drop', drop);
        window.addEventListener('dragend', cancel);
        window.addEventListener('keydown', esc);

        return () => {
            window.removeEventListener('dragenter', enter);
            window.removeEventListener('dragover', over);
            window.removeEventListener('dragleave', leave);
            window.removeEventListener('drop', drop);
            window.removeEventListener('dragend', cancel);
            window.removeEventListener('keydown', esc);
        };
    }, [uuid, directory, enabled]);

    if (!visible) return null;

    return (
        <div className={'gb-dropzone'} aria-hidden>
            <div>
                <CloudUpload />
                <strong>Drop to upload</strong>
                <span>Files and folders go into {displayPath(directory)}</span>
            </div>
        </div>
    );
};
