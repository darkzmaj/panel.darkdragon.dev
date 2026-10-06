import { EMPTY_TABS, type Tab, type TabsState } from './tabs';

const key = (uuid: string) => `gobia-files:${uuid}`;
/** sessionStorage holds a few MB; unsaved work beyond this is not kept across navigation. */
const MAX_STORED_CHARS = 2_000_000;

/** Keep the open tabs, with their unsaved text, when the user leaves the page and comes back in the same tab. */
export function saveTabs(uuid: string, state: TabsState): void {
    try {
        const ready = state.tabs.filter((tab) => tab.status === 'ready');
        const size = ready.reduce((sum, tab) => sum + tab.content.length + tab.original.length, 0);
        if (ready.length === 0 || size > MAX_STORED_CHARS) {
            sessionStorage.removeItem(key(uuid));
            return;
        }
        sessionStorage.setItem(key(uuid), JSON.stringify({ tabs: ready, active: state.active }));
    } catch {
        // Storage can be unavailable or full; the workspace still works, it just forgets its tabs.
    }
}

interface StoredState {
    tabs?: Partial<Tab>[];
    active?: string | null;
}

export function loadTabs(uuid: string): TabsState {
    try {
        const raw = sessionStorage.getItem(key(uuid));
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
