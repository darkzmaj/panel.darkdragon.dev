import type { AccountServer } from '@/api/account/servers/queries';
import {
    Activity,
    Archive,
    ArrowLeft,
    Blocks,
    Clock,
    Folder,
    SquareTerminal,
    Copy,
    Database,
    Egg,
    ExternalLink,
    FolderTree,
    KeyRound,
    LayoutDashboard,
    MapPin,
    Network,
    Play,
    RefreshCw,
    Server,
    Settings,
    ShieldCheck,
    Tag,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { useCurrentUser } from '@/api/account/queries';
import { useServerStatus } from '@/state/server';
import { useLiveStats } from '@/gobia/liveStats';
import StatusDots from '@/gobia/StatusDots';
import { levelOf, modeOf } from '@/gobia/statusLevels';
import { bytesToString } from '@/lib/formatters';
import Can from '@/components/elements/Can';
import NavigationLabel from '@/extensions/NavigationLabel';
import { ScreenGate } from '@/extensions/screenNavigation';
import Slot from '@/extensions/Slot';
import { NavItem, NavLabel } from '@/gobia/shell/Nav';
import ServerSwitcher from '@/gobia/shell/ServerSwitcher';
import { getAreaNav, type AreaNavEntry } from '@/router/nav';

/** Workspace, account and administration links shown beside the instance list and the account pages. */
export function DefaultSidebar() {
    const rootAdmin = useCurrentUser().rootAdmin;

    return (
        <>
            <NavLabel>Workspace</NavLabel>
            <NavItem to={'/'} exact icon={Server}>
                Instances
            </NavItem>
            <NavLabel>Account</NavLabel>
            <NavItem to={'/account'} icon={Settings}>
                Account
            </NavItem>
            {rootAdmin && (
                <>
                    <NavLabel>Administration</NavLabel>
                    <NavItem to={'/panel'} icon={ShieldCheck}>
                        Admin
                    </NavItem>
                </>
            )}
        </>
    );
}

const serverIcons = new Map<string, LucideIcon>([
    ['', SquareTerminal],
    ['files', Folder],
    ['databases', Database],
    ['schedules', Clock],
    ['users', Users],
    ['backups', Archive],
    ['network', Network],
    ['startup', Play],
    ['settings', Settings],
    ['activity', Activity],
]);

const MIB = 1024 * 1024;

interface ServerSidebarProps {
    id: string;
    name: string;
    node: string;
    internalId: number;
    server: AccountServer;
}

/** Back link, instance card and the instance pages. */
export function ServerSidebar({ id, name, node, internalId, server }: ServerSidebarProps) {
    const rootAdmin = useCurrentUser().rootAdmin;
    const power = useServerStatus();
    const to = (segment: string) => `/server/${id}${segment ? `/${segment}` : ''}`;
    const live = useLiveStats(server.attributes.uuid);
    const limits = server.attributes.limits;
    const running = power === 'running' || power === 'starting' || power === 'stopping';

    return (
        <>
            <NavItem to={'/'} exact icon={ArrowLeft}>
                All instances
            </NavItem>
            <ServerSwitcher id={id}>
                <StatusDots
                    vertical
                    mode={modeOf(power || null, null)}
                    powerLabel={power || 'offline'}
                    cpu={{
                        level: levelOf(live?.cpu ?? null, limits?.cpu ?? 0),
                        text: `${Math.round(live?.cpu ?? 0)}%`,
                    }}
                    memory={{
                        level: levelOf(live?.memory ?? null, (limits?.memory ?? 0) * MIB),
                        text: bytesToString(live?.memory ?? 0),
                    }}
                    disk={{
                        level: levelOf(live?.disk ?? null, (limits?.disk ?? 0) * MIB),
                        text: bytesToString(live?.disk ?? 0),
                    }}
                />
                <span style={{ minWidth: 0 }}>
                    <strong
                        style={{
                            display: 'block',
                            color: 'var(--gb-text-strong)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {name}
                    </strong>
                    <span className={'gb-secondary'} style={{ fontSize: 12 }}>
                        {node} · {power || 'offline'}
                    </span>
                </span>
            </ServerSwitcher>
            <NavLabel>Instance</NavLabel>
            <Slot name={'server.navigation.before'} data={server} />
            {getAreaNav('server').map(({ segment, label, exact, permission, ...meta }) => {
                const link = (
                    <NavItem to={to(segment)} exact={exact} icon={serverIcons.get(segment)}>
                        <NavigationLabel
                            label={label}
                            {...meta}
                            icon={serverIcons.get(segment) ? undefined : meta.icon}
                        />
                    </NavItem>
                );

                return (
                    <ScreenGate key={segment || '/'} screen={meta.screen}>
                        {permission ? (
                            <Can action={permission} matchAny>
                                {link}
                            </Can>
                        ) : (
                            link
                        )}
                    </ScreenGate>
                );
            })}
            <Slot name={'server.navigation.after'} data={server} />
            {rootAdmin && (
                <>
                    <NavLabel>Administration</NavLabel>
                    <NavItem to={'/panel/servers/$id'} params={{ id: String(internalId) }} icon={ExternalLink}>
                        Manage in admin
                    </NavItem>
                </>
            )}
        </>
    );
}

const adminIcons = new Map<string, LucideIcon>([
    ['', LayoutDashboard],
    ['activity', Activity],
    ['users', Users],
    ['nodes', Network],
    ['locations', MapPin],
    ['servers', Server],
    ['templates', Copy],
    ['databases', Database],
    ['mounts', FolderTree],
    ['eggs', Egg],
    ['tags', Tag],
    ['extensions', Blocks],
    ['api', KeyRound],
    ['settings', Settings],
    ['updates', RefreshCw],
]);

// The Gobia admin groups. Entries a group does not name (extension screens) land in System.
const adminGroups: Array<{ label: string; segments: string[] }> = [
    { label: 'Dashboard', segments: ['', 'users'] },
    { label: 'Network', segments: ['nodes', 'locations', 'templates'] },
    { label: 'Services', segments: ['eggs', 'databases'] },
    { label: 'System', segments: ['settings', 'updates'] },
];

// Entries that stand for several merged pages stay highlighted on all of them.
const alsoActive = new Map<string, string[]>([
    ['nodes', ['/panel/servers']],
    ['eggs', ['/panel/mounts']],
    ['settings', ['/panel/api', '/panel/extensions', '/panel/tags']],
]);

const hrefFor = ({ segment }: AreaNavEntry) => `/panel${segment ? `/${segment}` : ''}`;

/** Administration navigation in the Gobia groups: Dashboard, Network, Services, System. */
export function AdminSidebar() {
    const entries = getAreaNav('admin');
    const grouped = new Set(adminGroups.flatMap((group) => group.segments));
    // Screens registered by other extensions land at the end of System.
    const extra = entries.filter((entry) => !grouped.has(entry.segment));

    const render = (entry: AreaNavEntry) => (
        <ScreenGate key={entry.segment || '/'} screen={entry.screen}>
            <NavItem
                to={hrefFor(entry)}
                exact={entry.exact ?? entry.segment === ''}
                icon={adminIcons.get(entry.segment)}
                alsoActive={alsoActive.get(entry.segment)}
            >
                <NavigationLabel {...entry} icon={adminIcons.get(entry.segment) ? undefined : entry.icon} />
            </NavItem>
        </ScreenGate>
    );

    return (
        <>
            <Slot name={'panel.navigation.before'} />
            {adminGroups.map((group) => {
                const items = group.segments
                    .map((segment) => entries.find((entry) => entry.segment === segment))
                    .filter((entry): entry is AreaNavEntry => entry !== undefined)
                    .concat(group.label === 'System' ? extra : []);

                return items.length === 0 ? null : (
                    <div key={group.label}>
                        <NavLabel>{group.label}</NavLabel>
                        {items.map(render)}
                    </div>
                );
            })}
            <Slot name={'panel.navigation.after'} />
        </>
    );
}
