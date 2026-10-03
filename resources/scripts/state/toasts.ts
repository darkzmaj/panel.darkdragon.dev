import { action, Action } from 'easy-peasy';

export interface Toast {
    id: number;
    type: 'success' | 'error' | 'info';
    message: string;
    // Optional recovery action, for example "Retry".
    actionLabel?: string;
    onAction?: () => void;
}

export interface ToastStore {
    items: Toast[];
    push: Action<ToastStore, Omit<Toast, 'id'> & { id?: number }>;
    dismiss: Action<ToastStore, number>;
}

let next = 1;

// Small, non-blocking notifications that never move the page around.
const toasts: ToastStore = {
    items: [],
    push: action((state, payload) => {
        // The same message replaces the previous one instead of stacking up.
        state.items = [
            ...state.items.filter((t) => t.message !== payload.message).slice(-2),
            { ...payload, id: payload.id ?? next++ },
        ];
    }),
    dismiss: action((state, payload) => {
        state.items = state.items.filter((t) => t.id !== payload);
    }),
};

export default toasts;
