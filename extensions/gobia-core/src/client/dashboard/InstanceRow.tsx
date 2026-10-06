import { ContextDropdownMenu, DropdownMenu, DropdownMenuItem, PanelLink, useServerResources } from '@pterodactyl/sdk';
import {
    FolderPlus,
    GripVertical,
    MoreVertical,
    Palette,
    Server as ServerIcon,
    SquareArrowOutUpRight,
} from 'lucide-react';
import { memo, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { readableOn } from './colors';
import { formatBytes, formatCpu, formatLimit } from './format';
import type { DragState } from './useDragReorder';
import type { Instance } from './types';

type PowerState = 'offline' | 'stopped' | 'starting' | 'running' | 'stopping';

const STATE_LABEL = {
    offline: 'Offline',
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
} satisfies Record<PowerState, string>;

function dotClass(state: PowerState | null): string {
    switch (state) {
        case 'running':
            return 'gb:bg-success';
        case 'starting':
        case 'stopping':
            return 'gb:bg-warning gb:animate-pulse';
        default:
            return 'gb:bg-muted-foreground/50';
    }
}

/** True once the element has been on screen, so off screen rows never poll for live stats. */
function useEverVisible(): [Ref<HTMLDivElement>, boolean] {
    const ref = useRef<HTMLDivElement>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || seen) return;
        if (!('IntersectionObserver' in window)) {
            setSeen(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => entries.some((entry) => entry.isIntersecting) && setSeen(true),
            { rootMargin: '200px' }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [seen]);
    return [ref, seen];
}

function Metric({ label, value, limit }: { label: string; value: string; limit: string }) {
    return (
        <div className={'gb:hidden gb:min-w-24 gb:flex-col gb:text-right gb:leading-tight gb:md:flex'}>
            <span className={'gb:text-sm gb:tabular-nums gb:text-foreground'} aria-label={label}>
                {value}
            </span>
            <span className={'gb:text-xs gb:text-muted-foreground'}>of {limit}</span>
        </div>
    );
}

function LiveStats({ instance }: { instance: Instance }) {
    const { data } = useServerResources(instance.uuid);
    const state = (data?.attributes.current_state ?? null) as PowerState | null;
    const resources = data?.attributes.resources;
    return (
        <>
            <span className={'gb:flex gb:items-center gb:gap-2 gb:text-xs gb:text-muted-foreground'} role={'status'}>
                <span className={`gb:size-2 gb:rounded-full ${dotClass(state)}`} aria-hidden />
                <span className={'gb:hidden gb:sm:inline'}>{state ? STATE_LABEL[state] : 'Checking'}</span>
            </span>
            <Metric
                label={'CPU'}
                value={resources ? formatCpu(resources.cpu_absolute) : '–'}
                limit={instance.limits.cpu === 0 ? 'Unlimited' : `${instance.limits.cpu}%`}
            />
            <Metric
                label={'Memory'}
                value={resources ? formatBytes(resources.memory_bytes) : '–'}
                limit={formatLimit(instance.limits.memory)}
            />
            <Metric
                label={'Disk'}
                value={resources ? formatBytes(resources.disk_bytes) : '–'}
                limit={formatLimit(instance.limits.disk)}
            />
        </>
    );
}

function StatusBadge({ status }: { status: string }) {
    const label =
        status === 'suspended'
            ? 'Suspended'
            : status === 'installing'
              ? 'Installing'
              : status === 'install_failed'
                ? 'Install failed'
                : 'Unavailable';
    const tone = status === 'installing' ? 'gb:text-warning' : 'gb:text-destructive';
    return <span className={`gb:text-xs gb:font-medium ${tone}`}>{label}</span>;
}

interface Props {
    instance: Instance;
    dragging: boolean;
    drag: DragState;
    onColor: (instance: Instance) => void;
    onCategories: (instance: Instance) => void;
}

function InstanceRow({ instance, dragging, drag, onColor, onCategories }: Props) {
    const [visibleRef, visible] = useEverVisible();
    const color = instance.icon_color;
    const destination = { to: '/server/$id', params: { id: instance.identifier } } as const;

    const items: ReactNode = (
        <>
            <PanelLink destination={destination} className={'gb:contents'}>
                <DropdownMenuItem icon={SquareArrowOutUpRight}>Open</DropdownMenuItem>
            </PanelLink>
            <DropdownMenuItem icon={Palette} onClick={() => onColor(instance)}>
                Change icon colour
            </DropdownMenuItem>
            <DropdownMenuItem icon={FolderPlus} onClick={() => onCategories(instance)}>
                Add to category
            </DropdownMenuItem>
        </>
    );

    return (
        <ContextDropdownMenu items={items}>
            <div
                ref={(element) => {
                    drag.rowRef(instance.uuid)(element);
                }}
                data-instance={instance.uuid}
                className={
                    'gb:group gb:relative gb:flex gb:items-center gb:gap-3 gb:rounded-lg gb:border gb:border-border gb:bg-card gb:px-2 gb:py-2.5 gb:transition-colors gb:hover:bg-secondary/60 ' +
                    (dragging ? 'gb:opacity-40' : '')
                }
            >
                <button
                    type={'button'}
                    aria-label={`Reorder ${instance.name}. Press Space to pick up, then use the arrow keys.`}
                    {...drag.handleProps(instance.uuid)}
                    style={{ touchAction: 'none' }}
                    className={
                        'gb:grid gb:size-8 gb:shrink-0 gb:cursor-grab gb:place-items-center gb:rounded-md gb:text-muted-foreground gb:hover:text-foreground gb:focus-visible:outline-2 gb:focus-visible:outline-ring gb:active:cursor-grabbing'
                    }
                >
                    <GripVertical size={16} />
                </button>

                <PanelLink
                    destination={destination}
                    className={'gb:flex gb:min-w-0 gb:flex-1 gb:items-center gb:gap-3 gb:no-underline'}
                    aria-label={instance.name}
                >
                    <span
                        aria-hidden
                        style={color ? { backgroundColor: color, color: readableOn(color) } : undefined}
                        className={
                            'gb:grid gb:size-10 gb:shrink-0 gb:place-items-center gb:rounded-lg gb:border gb:border-border gb:bg-secondary gb:text-secondary-foreground'
                        }
                    >
                        <ServerIcon size={20} />
                    </span>
                    <span className={'gb:flex gb:min-w-0 gb:flex-col'}>
                        <span className={'gb:truncate gb:font-medium gb:text-foreground'}>{instance.name}</span>
                        <span className={'gb:truncate gb:text-xs gb:text-muted-foreground'}>
                            {[instance.address, instance.is_owner ? null : 'Shared with you']
                                .filter(Boolean)
                                .join(' · ') ||
                                instance.description ||
                                ' '}
                        </span>
                    </span>
                </PanelLink>

                <div ref={visibleRef} className={'gb:flex gb:shrink-0 gb:items-center gb:gap-4'}>
                    {instance.status ? (
                        <StatusBadge status={instance.status} />
                    ) : visible ? (
                        <LiveStats instance={instance} />
                    ) : (
                        <span className={'gb:size-2 gb:rounded-full gb:bg-muted-foreground/30'} aria-hidden />
                    )}
                </div>

                <DropdownMenu
                    triggerContent={<MoreVertical size={16} aria-label={`Actions for ${instance.name}`} />}
                    triggerClassName={
                        'gb:grid gb:size-8 gb:place-items-center gb:rounded-md gb:text-muted-foreground gb:hover:text-foreground'
                    }
                >
                    {items}
                </DropdownMenu>
            </div>
        </ContextDropdownMenu>
    );
}

export default memo(InstanceRow);
