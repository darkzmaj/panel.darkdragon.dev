import { describe, expect, it } from 'vitest';
import { allKeys, presetKeys, toggleGroup, toggleKey, type PermissionGroups } from './permissions';

const groups: PermissionGroups = {
    websocket: { description: 'Console', keys: { connect: 'Connect' } },
    control: { description: 'Power', keys: { console: 'Send', start: 'Start' } },
    file: { description: 'Files', keys: { read: 'Read', create: 'Create' } },
    ext: { description: 'Ext', keys: {} },
};

describe('permissions', () => {
    it('lists every key with its group prefix', () => {
        expect(allKeys(groups)).toEqual([
            'websocket.connect',
            'control.console',
            'control.start',
            'file.read',
            'file.create',
        ]);
    });

    it('builds presets from the keys that exist', () => {
        expect(presetKeys('view', groups)).toEqual(['websocket.connect', 'file.read']);
        expect(presetKeys('control', groups)).toEqual(['websocket.connect', 'control.console', 'control.start']);
        expect(presetKeys('full', groups)).toHaveLength(5);
        expect(presetKeys('view', {})).toEqual([]);
    });

    it('toggles keys without duplicates', () => {
        expect(toggleKey(['a'], 'b', true)).toEqual(['a', 'b']);
        expect(toggleKey(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
        expect(toggleKey(['a', 'b'], 'a', false)).toEqual(['b']);
    });

    it('toggles a whole group', () => {
        expect(toggleGroup(['file.read'], 'control', groups.control, true)).toEqual([
            'file.read',
            'control.console',
            'control.start',
        ]);
        expect(toggleGroup(['control.start', 'file.read'], 'control', groups.control, false)).toEqual(['file.read']);
    });
});
