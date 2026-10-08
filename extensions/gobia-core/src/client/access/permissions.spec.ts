import { describe, expect, it } from 'vitest';
import {
    LABELS,
    PRESETS,
    allKeys,
    grantableOn,
    labelOf,
    presetKeys,
    presetOf,
    toggleGroup,
    toggleKey,
    type PermissionGroups,
} from './permissions';

// The permission catalog of the panel (app/Models/Permission.php), keys only.
const groups: PermissionGroups = Object.fromEntries(
    Object.entries({
        websocket: ['connect'],
        control: ['console', 'start', 'stop', 'restart'],
        user: ['create', 'read', 'update', 'delete'],
        file: ['create', 'read', 'read-content', 'update', 'delete', 'archive', 'sftp'],
        backup: ['create', 'read', 'delete', 'download', 'restore'],
        allocation: ['read', 'create', 'update', 'delete'],
        startup: ['read', 'update', 'docker-image'],
        database: ['create', 'read', 'update', 'delete', 'view_password'],
        schedule: ['create', 'read', 'update', 'delete'],
        settings: ['rename', 'reinstall'],
        activity: ['read'],
    }).map(([prefix, keys]) => [
        prefix,
        { description: prefix, keys: Object.fromEntries(keys.map((key) => [key, key])) },
    ])
);

describe('permission presets', () => {
    it('only use ids the panel defines', () => {
        const known = allKeys(groups);
        for (const preset of ['view', 'manage'] as const) {
            expect(PRESETS[preset].filter((key) => !known.includes(key))).toEqual([]);
        }
    });

    it('View Only reads and watches and never reads file contents, passwords or people', () => {
        const keys = presetKeys('view', groups, null);
        expect(keys).toContain('websocket.connect');
        for (const risky of [
            'file.read-content',
            'database.view_password',
            'backup.download',
            'user.read',
            'control.start',
            'file.update',
        ]) {
            expect(keys).not.toContain(risky);
        }
    });

    it('Manage Server controls the server but never hands out user management or destructive rights', () => {
        const keys = presetKeys('manage', groups, null);
        expect(keys).toEqual(
            expect.arrayContaining(['control.start', 'control.console', 'file.update', 'schedule.update'])
        );
        for (const risky of [
            'user.create',
            'user.update',
            'user.delete',
            'user.read',
            'backup.restore',
            'backup.delete',
            'settings.reinstall',
            'startup.docker-image',
            'file.sftp',
            'database.view_password',
        ]) {
            expect(keys).not.toContain(risky);
        }
    });

    it('Full Access is everything the granter may hand out and nothing more', () => {
        expect(presetKeys('full', groups, null)).toEqual(allKeys(groups));
        const limited = ['websocket.connect', 'control.start', 'file.read'];
        expect(presetKeys('full', groups, limited)).toEqual(limited);
        expect(presetKeys('manage', groups, limited)).toEqual(limited);
    });

    it('recognises a preset by its exact selection', () => {
        expect(presetOf(presetKeys('view', groups, null), groups, null)).toBe('view');
        expect(presetOf([...presetKeys('manage', groups, null)].reverse(), groups, null)).toBe('manage');
        expect(presetOf(presetKeys('full', groups, null), groups, null)).toBe('full');
        expect(presetOf(['websocket.connect', 'control.start'], groups, null)).toBeNull();
    });

    it('intersects what several instances allow', () => {
        expect(grantableOn([{ grantable: null }, { grantable: null }])).toBeNull();
        expect(grantableOn([{ grantable: null }, { grantable: ['a', 'b'] }, { grantable: ['b', 'c'] }])).toEqual(['b']);
    });
});

describe('labels', () => {
    it('name every catalog permission in plain words', () => {
        const known = allKeys(groups);
        expect(known.filter((key) => !(key in LABELS))).toEqual([]);
        expect(labelOf('control.start', '').title).toBe('Start Server');
        expect(labelOf('websocket.connect', '').hint).toBe('See console output and live server information.');
    });

    it('shorten an unknown extension permission', () => {
        const label = labelOf('ext.votes.view-results', 'Allows a user to see the results. It is long.');
        expect(label.title).toBe('Votes view results');
        expect(label.hint).toBe('Allows a user to see the results');
    });
});

describe('toggling', () => {
    it('toggles a key without duplicates', () => {
        expect(toggleKey(['a'], 'b', true)).toEqual(['a', 'b']);
        expect(toggleKey(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
        expect(toggleKey(['a', 'b'], 'a', false)).toEqual(['b']);
    });

    it('toggles a group but only the keys that may be granted', () => {
        const group = groups.control!;
        expect(toggleGroup([], 'control', group, true, ['control.start', 'file.read'])).toEqual(['control.start']);
        expect(toggleGroup(['control.start', 'file.read'], 'control', group, false)).toEqual(['file.read']);
    });
});
