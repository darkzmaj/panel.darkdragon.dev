import { EMPTY_TABS, type Tab, type TabsState } from './tabs';

// The second pane of the dual workspace keeps its own tabs, even when it shows the same server as the first.
const key = (uuid: string, pane = 'a') => (pane === 'a' ? `gobia-files:${uuid}` : `gobia-files:${uuid}:${pane}`);
/** A path another page asks the workspace to open on arrival (once). */
export const OPEN_KEY = (uuid: string) => `gobia-files:open:${uuid}`;

export function takePendingOpen(uuid: string): string | null {
    try {
        const path = sessionStorage.getItem(OPEN_KEY(uuid));
        sessionStorage.removeItem(OPEN_KEY(uuid));
        return path;
    } catch {
        return null;
    }
}
/** sessionStorage holds a few MB; unsaved work beyond this is not kept across navigation. */
const MAX_STORED_CHARS = 2_000_000;

/** Keep the open tabs, with their unsaved text, when the user leaves the page and comes back in the same tab. */
export function saveTabs(uuid: string, state: TabsState, pane = 'a'): void {
    try {
        const ready = state.tabs.filter((tab) => tab.status === 'ready');
        const size = ready.reduce((sum, tab) => sum + tab.content.length + tab.original.length, 0);
        if (ready.length === 0 || size > MAX_STORED_CHARS) {
            sessionStorage.removeItem(key(uuid, pane));
            return;
        }
        sessionStorage.setItem(key(uuid, pane), JSON.stringify({ tabs: ready, active: state.active }));
    } catch {
        // Storage can be unavailable or full; the workspace still works, it just forgets its tabs.
    }
}

interface StoredState {
    tabs?: Partial<Tab>[];
    active?: string | null;
}

export function loadTabs(uuid: string, pane = 'a'): TabsState {
    try {
        const raw = sessionStorage.getItem(key(uuid, pane));
        if (!raw) return EMPTY_TABS;
        const parsed: StoredState = JSON.parse(raw);
        const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : []).flatMap((tab) =>
            tab?.path && tab.content !== undefined && tab.original !== undefined
                ? [
                      {
                          path: String(tab.path),
                          name: String(tab.name ?? tab.path),
                          content: String(tab.content),
                          original: String(tab.original),
                          modifiedAt:
                              tab.modifiedAt === null || tab.modifiedAt === undefined ? null : String(tab.modifiedAt),
                          status: 'ready' as const,
                          error: null,
                          saving: false,
                          rev: 0,
                      },
                  ]
                : []
        );
        const active = tabs.some((tab) => tab.path === parsed.active)
            ? (parsed.active ?? null)
            : (tabs[0]?.path ?? null);
        return { tabs, active };
    } catch {
        return EMPTY_TABS;
    }
}
