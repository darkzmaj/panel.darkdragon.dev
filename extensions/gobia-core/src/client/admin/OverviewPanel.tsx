import { Spinner, http } from '@pterodactyl/sdk';
import { useQuery } from '@tanstack/react-query';
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

const TOTALS = [
    ['users', 'Users'],
    ['administrators', 'Administrators'],
    ['nodes', 'Nodes'],
    ['instances', 'Instances'],
    ['databases', 'Databases'],
    ['locations', 'Locations'],
    ['mounts', 'Mounts'],
    ['templates', 'Templates'],
] as const;

function Bar({ label, resource }: { label: string; resource: Resource }) {
    const percent = (value: number) => (resource.total > 0 ? Math.min(100, (value / resource.total) * 100) : 0);
    return (
        <div className={'gb:flex gb:flex-col gb:gap-1.5'}>
            <div className={'gb:flex gb:items-baseline gb:justify-between gb:text-sm'}>
                <span className={'gb:font-medium'}>{label}</span>
                <span className={'gb:text-xs gb:text-muted-foreground'}>{formatBytes(resource.total)} total</span>
            </div>
            <div
                className={'gb:relative gb:h-2 gb:overflow-hidden gb:rounded-full gb:bg-sunken'}
                role={'img'}
                aria-label={`${label}: ${formatBytes(resource.allocated)} allocated${resource.used === null ? '' : `, ${formatBytes(resource.used)} in use`}`}
            >
                <div
                    style={{ width: `${percent(resource.allocated)}%` }}
                    className={'gb:absolute gb:inset-y-0 gb:left-0 gb:bg-primary/35'}
                />
                {resource.used !== null && (
                    <div
                        style={{ width: `${percent(resource.used)}%` }}
                        className={'gb:absolute gb:inset-y-0 gb:left-0 gb:bg-primary'}
                    />
                )}
            </div>
            <div className={'gb:flex gb:gap-4 gb:text-xs gb:text-muted-foreground'}>
                <span>Allocated {formatBytes(resource.allocated)}</span>
                <span>
                    {resource.used === null ? 'Live usage unavailable' : `In use ${formatBytes(resource.used)}`}
                </span>
            </div>
        </div>
    );
}

function Status({ status }: { status: NodeRow['status'] }) {
    const tone =
        status === 'online' ? 'gb:bg-success' : status === 'maintenance' ? 'gb:bg-warning' : 'gb:bg-destructive';
    return (
        <span className={'gb:inline-flex gb:items-center gb:gap-2 gb:text-xs'}>
            <span className={`gb:size-2 gb:rounded-full ${tone}`} aria-hidden />
            {status === 'online' ? 'Online' : status === 'maintenance' ? 'Maintenance' : 'Offline'}
        </span>
    );
}

export default function OverviewPanel() {
    const { data, isPending, isError } = useQuery({
        queryKey: ['gobia-core', 'admin', 'overview'],
        queryFn: async () => (await http.get<Overview>('/api/admin/extensions/gobia-core/overview')).data,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    if (isPending) return <Spinner centered />;
    if (isError)
        return <p className={'gb:mb-6 gb:text-sm gb:text-destructive'}>The Gobia overview could not be loaded.</p>;

    return (
        <section aria-label={'Gobia overview'} className={'gb:mb-8 gb:flex gb:flex-col gb:gap-6'}>
            <div className={'gb:grid gb:grid-cols-2 gb:gap-3 gb:sm:grid-cols-4'}>
                {TOTALS.map(([key, label]) => (
                    <div key={key} className={'gb:rounded-lg gb:border gb:border-border gb:bg-card gb:p-4'}>
                        <p className={'gb:text-2xl gb:font-semibold gb:tabular-nums'}>{data.totals[key]}</p>
                        <p className={'gb:text-xs gb:text-muted-foreground'}>{label}</p>
                    </div>
                ))}
            </div>

            <div
                className={
                    'gb:grid gb:gap-4 gb:rounded-lg gb:border gb:border-border gb:bg-card gb:p-4 gb:md:grid-cols-3'
                }
            >
                <Bar label={'Memory'} resource={data.resources.ram} />
                <Bar label={'Storage'} resource={data.resources.storage} />
                <div className={'gb:flex gb:flex-col gb:gap-1.5 gb:text-sm'}>
                    <span className={'gb:font-medium'}>Processor</span>
                    <span className={'gb:text-2xl gb:font-semibold gb:tabular-nums'}>
                        {data.resources.cpu.percent === null ? 'n/a' : `${data.resources.cpu.percent}%`}
                    </span>
                    <span className={'gb:text-xs gb:text-muted-foreground'}>
                        {data.resources.nodes.online + data.resources.nodes.maintenance} of {data.resources.nodes.total}{' '}
                        nodes reporting
                        {data.resources.instances.running !== null &&
                            ` · ${data.resources.instances.running} of ${data.resources.instances.total} instances running`}
                    </span>
                </div>
            </div>

            {data.nodes.length > 0 && (
                <div className={'gb:overflow-x-auto gb:rounded-lg gb:border gb:border-border gb:bg-card'}>
                    <table className={'gb:w-full gb:text-left gb:text-sm'}>
                        <caption className={'gb:sr-only'}>Nodes</caption>
                        <thead className={'gb:text-xs gb:uppercase gb:text-muted-foreground'}>
                            <tr>
                                {['Node', 'Status', 'Instances', 'Memory', 'Storage', 'CPU'].map((heading) => (
                                    <th key={heading} scope={'col'} className={'gb:px-4 gb:py-2 gb:font-medium'}>
                                        {heading}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.nodes.map((node) => (
                                <tr key={node.id} className={'gb:border-t gb:border-border'}>
                                    <th scope={'row'} className={'gb:px-4 gb:py-2 gb:font-medium'}>
                                        {node.name}
                                        {node.location && (
                                            <span
                                                className={'gb:ml-2 gb:text-xs gb:font-normal gb:text-muted-foreground'}
                                            >
                                                {node.location}
                                            </span>
                                        )}
                                    </th>
                                    <td className={'gb:px-4 gb:py-2'}>
                                        <Status status={node.status} />
                                    </td>
                                    <td className={'gb:px-4 gb:py-2 gb:tabular-nums'}>
                                        {node.instances_running === null
                                            ? node.instances
                                            : `${node.instances_running} / ${node.instances}`}
                                    </td>
                                    <td className={'gb:px-4 gb:py-2 gb:tabular-nums'}>
                                        {node.ram.used === null ? '–' : formatBytes(node.ram.used)} /{' '}
                                        {formatBytes(node.ram.allocated)} allocated
                                    </td>
                                    <td className={'gb:px-4 gb:py-2 gb:tabular-nums'}>
                                        {node.storage.used === null ? '–' : formatBytes(node.storage.used)} /{' '}
                                        {formatBytes(node.storage.allocated)} allocated
                                    </td>
                                    <td className={'gb:px-4 gb:py-2 gb:tabular-nums'}>
                                        {node.cpu.percent === null ? '–' : `${node.cpu.percent}%`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
