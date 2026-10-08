import { describe, expect, it } from 'vitest';
import { EMPTY_TABS, isDirty, tabsReducer, type TabsAction, type TabsState } from './tabs';

const run = (...actions: TabsAction[]): TabsState => actions.reduce(tabsReducer, EMPTY_TABS);
const open = (path: string): TabsAction => ({ type: 'open', path, name: path.split('/').pop() ?? path });
const loaded = (path: string, content = 'a'): TabsAction => ({ type: 'loaded', path, content, modifiedAt: 't1' });

import { tabsReducer as reducer, type TabsState as State } from './tabs';

const three: State = {
    tabs: ['/a', '/b', '/c'].map((path) => ({
        path,
        name: path.slice(1),
        original: '',
        content: '',
        modifiedAt: null,
        status: 'ready' as const,
        error: null,
        saving: false,
        rev: 0,
    })),
    active: '/a',
};

describe('tab reordering', () => {
    it('moves a tab to the dropped index and keeps the active one', () => {
        const next = reducer(three, { type: 'reorder', path: '/a', to: 2 });
        expect(next.tabs.map((tab) => tab.path)).toEqual(['/b', '/c', '/a']);
        expect(next.active).toBe('/a');
    });

    it('ignores unknown paths and clamps the target', () => {
        expect(reducer(three, { type: 'reorder', path: '/x', to: 0 })).toBe(three);
        expect(reducer(three, { type: 'reorder', path: '/c', to: -4 }).tabs[0]?.path).toBe('/c');
    });
});

describe('tabsReducer', () => {
    it('opens a file once and focuses it again', () => {
        const state = run(open('/a.txt'), open('/b.txt'), open('/a.txt'));
        expect(state.tabs.map((tab) => tab.path)).toEqual(['/a.txt', '/b.txt']);
        expect(state.active).toBe('/a.txt');
    });

    it('tracks unsaved changes per tab and clears them on save', () => {
        let state = run(open('/a.txt'), loaded('/a.txt'), open('/b.txt'), loaded('/b.txt'));
        state = tabsReducer(state, { type: 'edit', path: '/a.txt', content: 'changed' });
        expect(state.tabs.map(isDirty)).toEqual([true, false]);
        state = tabsReducer(state, { type: 'saved', path: '/a.txt', content: 'changed', modifiedAt: 't2' });
        expect(state.tabs.map(isDirty)).toEqual([false, false]);
        expect(state.tabs[0]?.modifiedAt).toBe('t2');
    });

    it('does not treat a tab that is still loading as dirty', () => {
        expect(run(open('/a.txt')).tabs.map(isDirty)).toEqual([false]);
    });

    it('activates the right neighbour when the active tab closes, then the last one', () => {
        const state = run(
            open('/a'),
            open('/b'),
            open('/c'),
            { type: 'activate', path: '/b' },
            { type: 'close', path: '/b' }
        );
        expect(state.active).toBe('/c');
        expect(tabsReducer(state, { type: 'close', path: '/c' }).active).toBe('/a');
        expect(
            tabsReducer(tabsReducer(state, { type: 'close', path: '/c' }), { type: 'close', path: '/a' }).active
        ).toBeNull();
    });

    it('keeps the active tab when another one closes', () => {
        const state = run(open('/a'), open('/b'), { type: 'close', path: '/a' });
        expect(state.active).toBe('/b');
    });

    it('records a failed load without losing the tab', () => {
        const state = run(open('/a'), { type: 'failed', path: '/a', error: 'nope' });
        expect(state.tabs[0]).toMatchObject({ status: 'error', error: 'nope' });
    });

    it('moves tabs with a renamed file or folder and keeps unsaved text', () => {
        let state = run(open('/plugins/a.yml'), loaded('/plugins/a.yml'), open('/b.txt'), loaded('/b.txt'));
        state = tabsReducer(state, { type: 'edit', path: '/plugins/a.yml', content: 'changed' });
        state = tabsReducer(state, { type: 'rename', from: '/plugins', to: '/mods' });
        expect(state.tabs.map((tab) => tab.path)).toEqual(['/mods/a.yml', '/b.txt']);
        expect(state.tabs[0]?.content).toBe('changed');
        expect(isDirty(state.tabs[0] as never)).toBe(true);
        state = tabsReducer(state, { type: 'rename', from: '/b.txt', to: '/c.txt' });
        expect(state.tabs[1]).toMatchObject({ path: '/c.txt', name: 'c.txt' });
    });
});
