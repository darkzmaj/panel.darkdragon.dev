import type { ClientServerResource } from '@/api/generated/types.gen';
import {
    Activity,
    ArchiveRestore,
    ArrowLeft,
    Blocks,
    CalendarClock,
    Cloud,
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
    Puzzle,
    RefreshCw,
    Server,
    Settings,
    ShieldCheck,
    Tag,
    Terminal,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { useCurrentUser } from '@/api/account/queries';
import Can from '@/components/elements/Can';
import NavigationLabel from '@/extensions/NavigationLabel';
import { ScreenGate } from '@/extensions/screenNavigation';
import Slot from '@/extensions/Slot';
import { NavItem, NavLabel } from '@/gobia/shell/Nav';
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

const serverIcons: Record<string, LucideIcon> = {
    '': Terminal,
    files: FolderTree,
    databases: Database,
    schedules: CalendarClock,
    users: Users,
    backups: ArchiveRestore,
    network: Network,
    startup: Play,
    settings: Settings,
    activity: Activity,
};

interface ServerSidebarProps {
    id: string;
    name: string;
    node: string;
    internalId: number;
    server: ClientServerResource;
}

/** Back link, instance card and the instance pages. */
export function ServerSidebar({ id, name, node, internalId, server }: ServerSidebarProps) {
    const rootAdmin = useCurrentUser().rootAdmin;
    const to = (segment: string) => `/server/${id}${segment ? `/${segment}` : ''}`;

    return (
        <>
            <NavItem to={'/'} exact icon={ArrowLeft}>
                All instances
            </NavItem>
            <div className={'gb-subcard'} style={{ margin: '10px 0 2px', padding: '12px 14px', minWidth: 0 }}>
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
                    {node}
                </span>
            </div>
            <NavLabel>Instance</NavLabel>
            <Slot name={'server.navigation.before'} data={server} />
            {getAreaNav('server').map(({ segment, label, exact, permission, ...meta }) => {
                const link = (
                    <NavItem to={to(segment)} exact={exact} icon={serverIcons[segment] ?? Puzzle}>
                        <NavigationLabel label={label} {...meta} />
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

const adminIcons: Record<string, LucideIcon> = {
    '': LayoutDashboard,
    activity: Activity,
    users: Users,
    nodes: Network,
    locations: MapPin,
    servers: Server,
    templates: Copy,
    databases: Database,
    mounts: FolderTree,
    eggs: Egg,
    tags: Tag,
    extensions: Blocks,
    api: KeyRound,
    settings: Settings,
    updates: RefreshCw,
};

// The Gobia admin groups. Entries a group does not name (extension screens) land in System.
const adminGroups: Array<{ label: string; segments: string[] }> = [
    { label: 'Dashboard', segments: ['', 'activity', 'users'] },
    { label: 'Network', segments: ['nodes', 'locations', 'servers', 'templates'] },
    { label: 'Services', segments: ['eggs', 'tags', 'mounts', 'databases'] },
];

const hrefFor = ({ segment }: AreaNavEntry) => `/panel${segment ? `/${segment}` : ''}`;

/** Administration navigation in the Gobia groups: Dashboard, Network, Services, System. */
export function AdminSidebar() {
    const entries = getAreaNav('admin');
    const grouped = new Set(adminGroups.flatMap((group) => group.segments));
    const system = entries.filter((entry) => !grouped.has(entry.segment));

    const render = (entry: AreaNavEntry) => (
        <ScreenGate key={entry.segment || '/'} screen={entry.screen}>
            <NavItem to={hrefFor(entry)} exact={entry.exact ?? entry.segment === ''} icon={adminIcons[entry.segment] ?? Cloud}>
                <NavigationLabel {...entry} />
            </NavItem>
        </ScreenGate>
    );

    return (
        <>
            <Slot name={'panel.navigation.before'} />
            {adminGroups.map((group) => {
                const items = entries.filter((entry) => group.segments.includes(entry.segment));

                return items.length === 0 ? null : (
                    <div key={group.label}>
                        <NavLabel>{group.label}</NavLabel>
                        {items.map(render)}
                    </div>
                );
            })}
            {system.length > 0 && (
                <div>
                    <NavLabel>System</NavLabel>
                    {system.map(render)}
                </div>
            )}
            <Slot name={'panel.navigation.after'} />
        </>
    );
}
