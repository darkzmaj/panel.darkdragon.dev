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

export type PresetId = 'view' | 'manage' | 'full';

export const PRESET_LABELS = {
    view: 'View Only',
    manage: 'Manage Server',
    full: 'Full Access',
} satisfies Record<PresetId, string>;

export const PRESET_HINTS = {
    view: 'Watch the console and look around. Nothing can be changed.',
    manage: 'Run the server, edit files and schedules. No user access, backups restore or reinstall.',
    full: 'Everything you are allowed to hand out, including who else gets access.',
} satisfies Record<PresetId, string>;

/**
 * The backend permission ids each preset selects. They are lists of real ids; an id the panel does not know, or one the
 * granter may not hand out, is dropped when the preset is applied.
 *
 * View Only reads and watches. It leaves out reading file contents (configuration files hold secrets), downloading
 * backups, database passwords and anything about other users.
 * Manage Server adds power control, the console, editing files and schedules, startup variables and renaming. It leaves
 * out user management, restoring or deleting backups, deleting databases, the Docker image, SFTP and reinstalling.
 */
export const PRESETS = {
    view: [
        'websocket.connect',
        'file.read',
        'backup.read',
        'allocation.read',
        'startup.read',
        'database.read',
        'schedule.read',
        'activity.read',
    ],
    manage: [
        'websocket.connect',
        'control.console',
        'control.start',
        'control.stop',
        'control.restart',
        'file.create',
        'file.read',
        'file.read-content',
        'file.update',
        'file.delete',
        'file.archive',
        'backup.create',
        'backup.read',
        'allocation.read',
        'startup.read',
        'startup.update',
        'database.read',
        'schedule.create',
        'schedule.read',
        'schedule.update',
        'schedule.delete',
        'settings.rename',
        'activity.read',
    ],
} satisfies Record<'view' | 'manage', readonly string[]>;

/** The keys a preset selects, limited to what exists and what the granter may give (`grantable` null means all). */
export function presetKeys(preset: PresetId, groups: PermissionGroups, grantable: readonly string[] | null): string[] {
    const known = allKeys(groups).filter((key) => grantable === null || grantable.includes(key));
    if (preset === 'full') return known;
    return known.filter((key) => (PRESETS[preset] as readonly string[]).includes(key));
}

/** Which preset a selection equals exactly, or null for a custom one. */
export function presetOf(selected: readonly string[], groups: PermissionGroups, grantable: readonly string[] | null) {
    for (const preset of ['view', 'manage', 'full'] as const) {
        const keys = presetKeys(preset, groups, grantable);
        if (keys.length === selected.length && keys.every((key) => selected.includes(key))) return preset;
    }
    return null;
}

/** The permissions the granter may hand out on every chosen server (null: all of them). */
export function grantableOn(servers: readonly { grantable: string[] | null }[]): string[] | null {
    const limited = servers.map((server) => server.grantable).filter((list): list is string[] => list !== null);
    if (limited.length === 0) return null;
    return limited.reduce((common, list) => common.filter((key) => list.includes(key)));
}

interface Label {
    title: string;
    hint: string;
}

/** Short, human wording for every permission the panel defines. The ids themselves are never renamed. */
export const LABELS = {
    'websocket.connect': { title: 'View Console', hint: 'See console output and live server information.' },
    'control.console': { title: 'Send Commands', hint: 'Type commands in the console.' },
    'control.start': { title: 'Start Server', hint: 'Turn the server on.' },
    'control.stop': { title: 'Stop Server', hint: 'Turn the server off.' },
    'control.restart': { title: 'Restart Server', hint: 'Restart the server.' },
    'file.create': { title: 'Create Files', hint: 'Add files and folders, upload.' },
    'file.read': { title: 'List Files', hint: 'See the files and folders.' },
    'file.read-content': { title: 'Open and Download Files', hint: 'Read and download file contents.' },
    'file.update': { title: 'Edit Files', hint: 'Change and rename files.' },
    'file.delete': { title: 'Delete Files', hint: 'Remove files and folders.' },
    'file.archive': { title: 'Archive Files', hint: 'Compress and extract archives.' },
    'file.sftp': { title: 'Use SFTP', hint: 'Connect with an SFTP client.' },
    'backup.create': { title: 'Create Backups', hint: 'Make new backups.' },
    'backup.read': { title: 'View Backups', hint: 'See the list of backups.' },
    'backup.delete': { title: 'Delete Backups', hint: 'Remove backups.' },
    'backup.download': { title: 'Download Backups', hint: 'Download a backup. It contains every file.' },
    'backup.restore': { title: 'Restore Backups', hint: 'Replace the server files with a backup.' },
    'database.create': { title: 'Create Databases', hint: 'Add a database.' },
    'database.read': { title: 'View Databases', hint: 'See the databases.' },
    'database.update': { title: 'Change Database Password', hint: 'Rotate a database password.' },
    'database.delete': { title: 'Delete Databases', hint: 'Remove a database.' },
    'database.view_password': { title: 'See Database Passwords', hint: 'Show database passwords.' },
    'schedule.create': { title: 'Create Schedules', hint: 'Add scheduled tasks.' },
    'schedule.read': { title: 'View Schedules', hint: 'See scheduled tasks.' },
    'schedule.update': { title: 'Edit Schedules', hint: 'Change and run schedules.' },
    'schedule.delete': { title: 'Delete Schedules', hint: 'Remove schedules.' },
    'allocation.read': { title: 'View Network', hint: 'See ports and addresses.' },
    'allocation.create': { title: 'Add Ports', hint: 'Assign extra ports.' },
    'allocation.update': { title: 'Change Main Port', hint: 'Set the main port and notes.' },
    'allocation.delete': { title: 'Remove Ports', hint: 'Remove extra ports.' },
    'startup.read': { title: 'View Startup', hint: 'See startup variables.' },
    'startup.update': { title: 'Edit Startup Variables', hint: 'Change startup variables.' },
    'startup.docker-image': { title: 'Change Docker Image', hint: 'Pick another Docker image.' },
    'settings.rename': { title: 'Rename Server', hint: 'Change the name and description.' },
    'settings.reinstall': { title: 'Reinstall Server', hint: 'Wipe and install again.' },
    'activity.read': { title: 'View Activity', hint: 'See what happened on the server.' },
    'user.create': { title: 'Add People', hint: 'Give others access.' },
    'user.read': { title: 'See Who Has Access', hint: 'View the people with access.' },
    'user.update': { title: 'Change Access', hint: "Change other people's permissions." },
    'user.delete': { title: 'Remove People', hint: "Take away others' access." },
} satisfies Record<string, Label>;

const LABEL_MAP = new Map<string, Label>(Object.entries(LABELS));

/** The label of a permission; an unknown (extension) permission shows its backend description, shortened. */
export function labelOf(key: string, fallback: string): Label {
    const known = LABEL_MAP.get(key);
    if (known) return known;
    const [, ...rest] = key.split('.');
    const title = (rest.join(' ') || key).replace(/[-_]/g, ' ');
    return { title: title.charAt(0).toUpperCase() + title.slice(1), hint: fallback.split('. ')[0]?.slice(0, 90) ?? '' };
}

/** The categories shown to people, in order, each with the backend group prefix it comes from. */
export const CATEGORIES = [
    ['Console', 'websocket'],
    ['Power', 'control'],
    ['Files', 'file'],
    ['Backups', 'backup'],
    ['Databases', 'database'],
    ['Schedules', 'schedule'],
    ['Network', 'allocation'],
    ['Startup', 'startup'],
    ['Settings', 'settings'],
    ['Activity', 'activity'],
    ['User Access', 'user'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

/** Toggle one key, keeping the list free of duplicates and in a stable order. */
export function toggleKey(selected: readonly string[], key: string, on: boolean): string[] {
    const without = selected.filter((item) => item !== key);
    return on ? [...without, key] : without;
}

export function toggleGroup(
    selected: readonly string[],
    prefix: string,
    group: PermissionGroup,
    on: boolean,
    grantable: readonly string[] | null = null
): string[] {
    const keys = Object.keys(group.keys)
        .map((key) => `${prefix}.${key}`)
        .filter((key) => grantable === null || grantable.includes(key));
    const without = selected.filter((item) => !keys.includes(item));
    return on ? [...without, ...keys] : without;
}
