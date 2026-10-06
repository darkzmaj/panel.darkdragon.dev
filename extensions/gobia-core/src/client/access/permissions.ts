export interface PermissionGroup {
    description: string;
    keys: Record<string, string>;
}

export type PermissionGroups = Record<string, PermissionGroup>;

/** Every grantable key such as `control.console`, in group order. */
export function allKeys(groups: PermissionGroups): string[] {
    return Object.entries(groups).flatMap(([prefix, group]) =>
        Object.keys(group.keys).map((key) => `${prefix}.${key}`)
    );
}

export type PresetId = 'view' | 'control' | 'full';

export const PRESET_LABELS = {
    view: 'View only',
    control: 'Console and power',
    full: 'Everything',
} satisfies Record<PresetId, string>;

/** The keys a preset selects. Presets only ever select keys that exist, so unknown groups never leak in. */
export function presetKeys(preset: PresetId, groups: PermissionGroups): string[] {
    const keys = allKeys(groups);
    switch (preset) {
        case 'full':
            return keys;
        case 'control':
            return keys.filter((key) => key === 'websocket.connect' || key.startsWith('control.'));
        case 'view':
            return keys.filter((key) => key === 'websocket.connect' || key.endsWith('.read'));
    }
}

/** Toggle one key, keeping the list free of duplicates and in a stable order. */
export function toggleKey(selected: readonly string[], key: string, on: boolean): string[] {
    const without = selected.filter((item) => item !== key);
    return on ? [...without, key] : without;
}

export function toggleGroup(
    selected: readonly string[],
    prefix: string,
    group: PermissionGroup,
    on: boolean
): string[] {
    const keys = Object.keys(group.keys).map((key) => `${prefix}.${key}`);
    const without = selected.filter((item) => !keys.includes(item));
    return on ? [...without, ...keys] : without;
}
