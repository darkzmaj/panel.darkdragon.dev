export interface Tab {
    path: string;
    name: string;
    /** Content as last read from or written to the server. */
    original: string;
    content: string;
    /** Modification time of the file when it was last read or written; used to detect outside changes. */
    modifiedAt: string | null;
    status: 'loading' | 'ready' | 'error';
    error: string | null;
    saving: boolean;
}

export interface TabsState {
    tabs: Tab[];
    active: string | null;
}

export type TabsAction =
    | { type: 'open'; path: string; name: string }
    | { type: 'loaded'; path: string; content: string; modifiedAt: string | null }
    | { type: 'failed'; path: string; error: string }
    | { type: 'edit'; path: string; content: string }
    | { type: 'saving'; path: string; saving: boolean }
    | { type: 'saved'; path: string; content: string; modifiedAt: string | null }
    | { type: 'activate'; path: string }
    | { type: 'close'; path: string }
    /** A file or folder moved on the server: tabs under `from` follow it and keep their text. */
    | { type: 'rename'; from: string; to: string }
    /** Drag a tab to a new position: `to` is the index it should end up at. */
    | { type: 'reorder'; path: string; to: number }
    | { type: 'restore'; state: TabsState };

export const EMPTY_TABS: TabsState = { tabs: [], active: null };

export const isDirty = (tab: Tab): boolean => tab.status === 'ready' && tab.content !== tab.original;

const patch = (state: TabsState, path: string, change: Partial<Tab>): TabsState => ({
    ...state,
    tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, ...change } : tab)),
});

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
    switch (action.type) {
        case 'open': {
            if (state.tabs.some((tab) => tab.path === action.path)) return { ...state, active: action.path };
            const tab: Tab = {
                path: action.path,
                name: action.name,
                original: '',
                content: '',
                modifiedAt: null,
                status: 'loading',
                error: null,
                saving: false,
            };
            return { tabs: [...state.tabs, tab], active: action.path };
        }
        case 'loaded':
            return patch(state, action.path, {
                original: action.content,
                content: action.content,
                modifiedAt: action.modifiedAt,
                status: 'ready',
                error: null,
            });
        case 'failed':
            return patch(state, action.path, { status: 'error', error: action.error });
        case 'edit':
            return patch(state, action.path, { content: action.content });
        case 'saving':
            return patch(state, action.path, { saving: action.saving });
        case 'saved':
            return patch(state, action.path, {
                original: action.content,
                modifiedAt: action.modifiedAt,
                saving: false,
            });
        case 'activate':
            return state.tabs.some((tab) => tab.path === action.path) ? { ...state, active: action.path } : state;
        case 'close': {
            const index = state.tabs.findIndex((tab) => tab.path === action.path);
            if (index < 0) return state;
            const tabs = state.tabs.filter((tab) => tab.path !== action.path);
            // Closing the active tab activates its right neighbour, or the new last tab.
            const active =
                state.active === action.path ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null) : state.active;
            return { tabs, active };
        }
        case 'rename': {
            const moved = (path: string) =>
                path === action.from
                    ? action.to
                    : path.startsWith(`${action.from}/`)
                      ? `${action.to}${path.slice(action.from.length)}`
                      : path;
            return {
                tabs: state.tabs.map((tab) => {
                    const path = moved(tab.path);
                    return path === tab.path ? tab : { ...tab, path, name: path.slice(path.lastIndexOf('/') + 1) };
                }),
                active: state.active === null ? null : moved(state.active),
            };
        }
        case 'reorder': {
            const from = state.tabs.findIndex((tab) => tab.path === action.path);
            if (from < 0) return state;
            const to = Math.min(Math.max(action.to, 0), state.tabs.length - 1);
            if (from === to) return state;
            const tabs = [...state.tabs];
            const [moved] = tabs.splice(from, 1);
            if (moved) tabs.splice(to, 0, moved);
            return { ...state, tabs };
        }
        case 'restore':
            return action.state;
    }
}
