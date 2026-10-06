import { describe, expect, it } from 'vitest';
import { failingChecks, isTerminal, updateGate } from './gate';
import type { Preflight, UpdateCheck } from './types';

const approved: UpdateCheck = {
    contract_version: 1,
    current: { gobia: '2.0.0', pterodactyl_base: 'a' },
    latest_approved: {
        gobia: '2.0.1',
        pterodactyl_base: 'b',
        published_at: '2026-10-07',
        security: false,
        release_notes_markdown: '',
    },
    update_available: true,
};
const ready: Preflight = {
    ready: true,
    checks: [{ id: 'php_version', required: true, status: 'pass', message: '' }],
    extensions: [],
    migrations: { pending: 0, destructive: false, rollback: 'file-only' },
};

describe('updateGate', () => {
    it('stays closed without an updater', () => expect(updateGate(null, ready)).toBe('no-updater'));
    it('stays closed when no approved release exists, however new upstream is', () => {
        expect(updateGate({ ...approved, update_available: false }, ready)).toBe('up-to-date');
        expect(updateGate({ ...approved, latest_approved: null }, ready)).toBe('up-to-date');
    });
    it('stays closed until the preflight says ready', () => {
        expect(updateGate(approved, null)).toBe('not-ready');
        expect(updateGate(approved, { ...ready, ready: false })).toBe('not-ready');
    });
    it('does not trust a ready flag that contradicts a failed required check', () => {
        const lying = {
            ...ready,
            checks: [{ id: 'disk_space', required: true, status: 'fail' as const, message: 'full' }],
        };
        expect(updateGate(approved, lying)).toBe('not-ready');
    });
    it('opens only with an approved release and a ready preflight', () =>
        expect(updateGate(approved, ready)).toBe('ready'));
    it('ignores failing optional checks', () => {
        const optional = {
            ...ready,
            checks: [...ready.checks, { id: 'wings', required: false, status: 'warn' as const, message: 'slow' }],
        };
        expect(updateGate(approved, optional)).toBe('ready');
        expect(failingChecks(optional)).toEqual([]);
    });
    it('lists failing checks and knows terminal states', () => {
        const bad = {
            ...ready,
            ready: false,
            checks: [{ id: 'disk_space', required: true, status: 'fail' as const, message: 'full' }],
        };
        expect(failingChecks(bad)).toHaveLength(1);
        expect(isTerminal('completed')).toBe(true);
        expect(isTerminal('migrating')).toBe(false);
    });
});
