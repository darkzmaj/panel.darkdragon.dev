import { RotateCw, X } from 'lucide-react';
import type { UploadItem } from './uploads';

interface UploadPanelProps {
    items: readonly UploadItem[];
    onCancel: (id: number) => void;
    onRetry: (id: number) => void;
    onClear: () => void;
}

const label = (item: UploadItem): string => {
    switch (item.status) {
        case 'queued':
            return 'Waiting';
        case 'uploading':
            return `${Math.round((item.loaded / Math.max(item.file.size, 1)) * 100)}%`;
        case 'done':
            return 'Uploaded';
        case 'cancelled':
            return 'Cancelled';
        case 'failed':
            return item.error ?? 'Failed';
    }
};

export default function UploadPanel({ items, onCancel, onRetry, onClear }: UploadPanelProps) {
    if (items.length === 0) return null;
    const finished = items.every((item) => item.status !== 'queued' && item.status !== 'uploading');
    return (
        <section
            aria-label={'Uploads'}
            className={'gf:rounded-lg gf:border gf:border-border gf:bg-card gf:p-2 gf:text-xs'}
        >
            <ul className={'gf:flex gf:max-h-40 gf:flex-col gf:gap-1 gf:overflow-y-auto'}>
                {items.map((item) => (
                    <li key={item.id} className={'gf:flex gf:items-center gf:gap-2'}>
                        <span
                            className={'gf:min-w-0 gf:flex-1 gf:truncate'}
                            title={`${item.directory}/${item.file.name}`}
                        >
                            {item.file.name}
                        </span>
                        {item.status === 'uploading' && (
                            <progress
                                max={Math.max(item.file.size, 1)}
                                value={item.loaded}
                                aria-label={`Uploading ${item.file.name}`}
                                className={'gf:w-20'}
                            />
                        )}
                        <span
                            className={item.status === 'failed' ? 'gf:text-destructive' : 'gf:text-muted-foreground'}
                            role={item.status === 'failed' ? 'alert' : undefined}
                        >
                            {label(item)}
                        </span>
                        {(item.status === 'queued' || item.status === 'uploading') && (
                            <button
                                type={'button'}
                                aria-label={`Cancel upload of ${item.file.name}`}
                                onClick={() => onCancel(item.id)}
                                className={'gf:grid gf:size-6 gf:place-items-center gf:rounded gf:hover:bg-secondary'}
                            >
                                <X size={14} aria-hidden />
                            </button>
                        )}
                        {(item.status === 'failed' || item.status === 'cancelled') && (
                            <button
                                type={'button'}
                                aria-label={`Retry upload of ${item.file.name}`}
                                onClick={() => onRetry(item.id)}
                                className={'gf:grid gf:size-6 gf:place-items-center gf:rounded gf:hover:bg-secondary'}
                            >
                                <RotateCw size={14} aria-hidden />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {finished && (
                <button type={'button'} onClick={onClear} className={'gf:mt-2 gf:text-muted-foreground gf:underline'}>
                    Clear list
                </button>
            )}
        </section>
    );
}
