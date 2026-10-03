import React, { useEffect } from 'react';
import { useStoreActions, useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { Toast } from '@/state/toasts';
import { Actions } from 'easy-peasy';

const COLORS: Record<Toast['type'], string> = {
    success: 'bg-green-700 text-green-50',
    error: 'bg-red-700 text-red-50',
    info: 'bg-neutral-700 text-neutral-50',
};

const Item = ({ toast }: { toast: Toast }) => {
    const dismiss = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.dismiss);

    useEffect(() => {
        // Errors with a recovery action stay until dismissed; everything else clears itself.
        if (toast.type === 'error' && toast.onAction) return;
        const timer = setTimeout(() => dismiss(toast.id), toast.type === 'error' ? 8000 : 3500);

        return () => clearTimeout(timer);
    }, [toast.id]);

    return (
        <div
            className={`pointer-events-auto flex items-center rounded shadow-lg px-4 py-2 text-sm mt-2 ${
                COLORS[toast.type]
            }`}
        >
            <span className={'flex-1 break-words'}>{toast.message}</span>
            {toast.onAction && (
                <button
                    type={'button'}
                    className={'ml-4 underline font-medium focus:outline-none focus:ring-2 focus:ring-white rounded'}
                    onClick={() => {
                        dismiss(toast.id);
                        toast.onAction!();
                    }}
                >
                    {toast.actionLabel || 'Retry'}
                </button>
            )}
            <button
                type={'button'}
                aria-label={'Dismiss'}
                className={'ml-3 opacity-70 hover:opacity-100'}
                onClick={() => dismiss(toast.id)}
            >
                &times;
            </button>
        </div>
    );
};

// Bottom-right notification area. Fixed, so showing a toast never shifts any content.
export default () => {
    const items = useStoreState((state: ApplicationStore) => state.toasts.items);

    return (
        <div
            aria-live={'polite'}
            className={
                'fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-[70] pointer-events-none flex flex-col items-end'
            }
        >
            {items.map((toast) => (
                <div key={toast.id} className={'w-full'}>
                    <Item toast={toast} />
                </div>
            ))}
        </div>
    );
};
