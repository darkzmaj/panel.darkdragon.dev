import { PanelLink, http } from '@pterodactyl/sdk';
import { useQuery } from '@tanstack/react-query';
import { Copy, Database, FolderTree, MapPin, Network, Server, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { formatBytes } from '../dashboard/format';

interface Resource {
    total: number;
    allocated: number;
    used: number | null;
}

interface NodeRow {
    id: number;
    name: string;
    location: string | null;
    fqdn?: string;
    version?: string | null;
    allocations?: { used: number; total: number };
    status: 'online' | 'maintenance' | 'offline';
    instances: number;
    instances_running: number | null;
    ram: Resource;
    storage: Resource;
    cpu: { percent: number | null; cores: number | null };
}

interface Overview {
    totals: Record<
        'users' | 'administrators' | 'nodes' | 'instances' | 'databases' | 'locations' | 'mounts' | 'templates',
        number
    >;
    resources: {
        ram: Resource;
        storage: Resource;
        cpu: { percent: number | null; nodes_reporting: number };
        instances: { total: number; running: number | null };
        nodes: { total: number; online: number; maintenance: number; offline: number };
    };
    nodes: NodeRow[];
}

type Totals = Overview['totals'];

const CARDS: Array<{ key: keyof Totals; label: string; icon: LucideIcon; to: string; note: (t: Totals) => string }> = [
    { key: 'users', label: 'Users', icon: Users, to: '/panel/users', note: () => 'accounts on this panel' },
    {
        key: 'administrators',
        label: 'Admins',
        icon: ShieldCheck,
        to: '/panel/users',
        note: (t) => `of ${t.users} user${t.users === 1 ? '' : 's'}`,
    },
    { key: 'nodes', label: 'Nodes', icon: Network, to: '/panel/nodes', note: () => 'Wings daemons' },
    { key: 'instances', label: 'Instances', icon: Server, to: '/panel/servers', note: () => 'across all nodes' },
    { key: 'templates', label: 'Templates', icon: Copy, to: '/panel/templates', note: () => 'reusable setups' },
    { key: 'databases', label: 'Databases', icon: Database, to: '/panel/databases', note: () => 'database hosts' },
    { key: 'locations', label: 'Locations', icon: MapPin, to: '/panel/locations', note: () => 'node groups' },
    { key: 'mounts', label: 'Mounts', icon: FolderTree, to: '/panel/mounts', note: () => 'shared mounts' },
];

const level = (percent: number | null) =>
    percent === null ? '' : percent >= 90 ? 'crit' : percent >= 75 ? 'warn' : '';
const pct = (part: number | null, whole: number) =>
    part !== null && whole > 0 ? Math.min(100, (part / whole) * 100) : null;
const live = (value: number | null, total: number) =>
    value === null ? 'unavailable' : `${formatBytes(value)}${total ? ` (${Math.round(pct(value, total) ?? 0)}%)` : ''}`;

function Meter({ label, used, total, text }: { label: string; used: number | null; total: number; text: string }) {
    const percent = pct(used, total);

    return (
        <div className={'gb-meter'}>
            <div className={'gb-meter-head'}>
                <span>{label}</span>
                <span>{text}</span>
            </div>
            <div className={'gb-bar'}>
                <span className={level(percent)} style={{ width: `${percent ?? 0}%` }} />
            </div>
        </div>
    );
}

/** A ring for what is promised to instances (allocation) and, separately, a bar for what is really in use. */
function Gauge({
    title,
    percent,
    headline,
    caption,
    rows,
    usage,
}: {
    title: string;
    percent: number | null;
    headline: string;
    caption: string;
    rows: Array<[string, string]>;
    usage?: { used: number | null; total: number };
}) {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;

    return (
        <div className={'gb-gauge'}>
            <div className={'gb-gauge-top'}>
                <svg
                    viewBox={'0 0 128 128'}
                    role={'img'}
                    aria-label={title + (percent === null ? ' unavailable' : ` ${Math.round(percent)} percent`)}
                >
                    <circle
                        className={'gb-ring-bg'}
                        cx={64}
                        cy={64}
                        r={radius}
                        fill={'none'}
                        strokeWidth={12}
                        strokeLinecap={'round'}
                    />
                    <circle
                        className={'gb-ring-fg ' + level(percent)}
                        cx={64}
                        cy={64}
                        r={radius}
                        fill={'none'}
                        strokeWidth={12}
                        strokeLinecap={'round'}
                        strokeDasharray={`${(circumference * (percent ?? 0)) / 100} ${circumference}`}
                        transform={'rotate(-90 64 64)'}
                    />
                    <text className={'gb-ring-text'} x={64} y={64}>
                        {percent === null ? 'n/a' : `${Math.round(percent)}%`}
                    </text>
                </svg>
                <div className={'gb-gauge-body'}>
                    <h4>{title}</h4>
                    <div className={'gb-gauge-value'}>{headline}</div>
                    <div className={'gb-gauge-caption'}>{caption}</div>
                </div>
            </div>
            <dl>
                {rows.map(([name, text]) => (
                    <div key={name}>
                        <dt>{name}</dt>
                        <dd>{text}</dd>
                    </div>
                ))}
            </dl>
            {usage && (
                <Meter
                    label={'Live usage'}
                    used={usage.used}
                    total={usage.total}
                    text={live(usage.used, usage.total)}
                />
            )}
        </div>
    );
}

function NodeCard({ node }: { node: NodeRow }) {
    const offline = node.status === 'offline';
    const liveText = (used: number | null, total: number) =>
        offline ? 'offline' : used === null ? 'unavailable' : `${formatBytes(used)} / ${formatBytes(total)}`;
    const tone =
        node.status === 'online'
            ? 'gb-badge-success'
            : node.status === 'maintenance'
              ? 'gb-badge-warning'
              : 'gb-badge-danger';

    return (
        <div className={'gb-node is-' + node.status}>
            <header>
                <div>
                    <PanelLink destination={{ to: '/panel/nodes/$id', params: { id: String(node.id) } } as never}>
                        {node.name}
                    </PanelLink>
                    <div className={'gb-sub'}>
                        {node.location ?? 'No location'}
                        {node.fqdn ? ` · ${node.fqdn}` : ''}
                    </div>
                </div>
                <span className={'gb-badge ' + tone}>{node.status}</span>
            </header>
            <dl className={'gb-node-facts'}>
                <div>
                    <dt>Instances</dt>
                    <dd>
                        {node.instances}
                        {node.instances_running !== null && ` (${node.instances_running} running)`}
                    </dd>
                </div>
                {node.allocations && (
                    <div>
                        <dt>Allocations</dt>
                        <dd>
                            {node.allocations.used} / {node.allocations.total}
                        </dd>
                    </div>
                )}
                <div>
                    <dt>Wings</dt>
                    <dd>{node.version ?? 'n/a'}</dd>
                </div>
            </dl>
            <Meter
                label={'RAM live'}
                used={node.ram.used}
                total={node.ram.total}
                text={liveText(node.ram.used, node.ram.total)}
            />
            <Meter
                label={'RAM allocated'}
                used={node.ram.allocated}
                total={node.ram.total}
                text={`${formatBytes(node.ram.allocated)} / ${formatBytes(node.ram.total)}`}
            />
            <Meter
                label={'Storage live'}
                used={node.storage.used}
                total={node.storage.total}
                text={liveText(node.storage.used, node.storage.total)}
            />
            <Meter
                label={'Storage allocated'}
                used={node.storage.allocated}
                total={node.storage.total}
                text={`${formatBytes(node.storage.allocated)} / ${formatBytes(node.storage.total)}`}
            />
            <Meter
                label={'CPU'}
                used={node.cpu.percent}
                total={100}
                text={
                    node.cpu.percent === null
                        ? 'unavailable'
                        : `${node.cpu.percent}%${node.cpu.cores ? ` of ${node.cpu.cores} cores` : ''}`
                }
            />
        </div>
    );
}

export default function OverviewPanel() {
    const { data, isPending, isError } = useQuery({
        queryKey: ['gobia-core', 'admin', 'overview'],
        queryFn: async () => (await http.get<Overview>('/api/admin/extensions/gobia-core/overview')).data,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    if (isPending) {
        return (
            <section aria-label={'Gobia overview'}>
                <div className={'gb-stats gb-stats-lg'}>
                    {CARDS.map((card) => (
                        <div key={card.key} className={'gb-skeleton'} style={{ height: 96, borderRadius: 14 }} />
                    ))}
                </div>
            </section>
        );
    }
    if (isError) return <p className={'gb-badge gb-badge-danger'}>The overview could not be loaded.</p>;

    const { ram, storage, cpu, instances, nodes } = data.resources;

    return (
        <section aria-label={'Gobia overview'}>
            <div className={'gb-stats gb-stats-lg'}>
                {CARDS.map(({ key, label, icon: Icon, to, note }) => (
                    <PanelLink key={key} destination={{ to } as never} className={'gb-stat'}>
                        <span className={'gb-stat-icon'}>
                            <Icon aria-hidden />
                        </span>
                        <span>
                            <span className={'gb-num'}>{data.totals[key].toLocaleString()}</span>
                            <span className={'gb-label'}>{label}</span>
                            <span className={'gb-note'}>{note(data.totals)}</span>
                        </span>
                    </PanelLink>
                ))}
            </div>

            <div className={'gb-section-title'}>Resources across all nodes</div>
            <div className={'gb-gauges gb-gauges-lg'}>
                <Gauge
                    title={'RAM'}
                    percent={pct(ram.allocated, ram.total)}
                    headline={formatBytes(ram.allocated)}
                    caption={`allocated of ${formatBytes(ram.total)}`}
                    rows={[
                        ['Available to allocate', formatBytes(Math.max(0, ram.total - ram.allocated))],
                        ['In use now', live(ram.used, ram.total)],
                    ]}
                    usage={{ used: ram.used, total: ram.total }}
                />
                <Gauge
                    title={'Storage'}
                    percent={pct(storage.allocated, storage.total)}
                    headline={formatBytes(storage.allocated)}
                    caption={`allocated of ${formatBytes(storage.total)}`}
                    rows={[
                        ['Available to allocate', formatBytes(Math.max(0, storage.total - storage.allocated))],
                        ['In use now', live(storage.used, storage.total)],
                    ]}
                    usage={{ used: storage.used, total: storage.total }}
                />
                <Gauge
                    title={'CPU'}
                    percent={cpu.percent === null ? null : Math.min(100, cpu.percent)}
                    headline={cpu.percent === null ? 'n/a' : `${cpu.percent}%`}
                    caption={'live utilisation'}
                    rows={[
                        ['Nodes reporting', `${cpu.nodes_reporting} of ${nodes.total}`],
                        ['Weighting', 'by core count'],
                    ]}
                />
                <Gauge
                    title={'Instances'}
                    percent={instances.running === null ? null : pct(instances.running, instances.total)}
                    headline={instances.running === null ? 'n/a' : `${instances.running} running`}
                    caption={`of ${instances.total} instances`}
                    rows={[
                        ['Nodes online', `${nodes.online} of ${nodes.total}`],
                        ['In maintenance', String(nodes.maintenance)],
                    ]}
                />
            </div>

            <div className={'gb-section-title'}>Nodes</div>
            <div className={'gb-nodes'}>
                {data.nodes.length === 0 && <div className={'gb-muted'}>No nodes have been created yet.</div>}
                {data.nodes.map((node) => (
                    <NodeCard key={node.id} node={node} />
                ))}
            </div>
        </section>
    );
}
