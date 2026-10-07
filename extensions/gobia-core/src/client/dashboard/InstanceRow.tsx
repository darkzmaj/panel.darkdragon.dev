import { ContextDropdownMenu, DropdownMenu, DropdownMenuItem, PanelLink, useServerResources } from '@pterodactyl/sdk';
import {
    Cpu,
    Ellipsis,
    FolderPlus,
    GripVertical,
    HardDrive,
    MemoryStick,
    Palette,
    Server as ServerIcon,
    SquareArrowOutUpRight,
} from 'lucide-react';
import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
            return 'gb-dot-success';
        case 'starting':
        case 'stopping':
            return 'gb-dot-warning';
        default:
            return '';
    }
}

/** True once the element has been on screen, so off screen rows never poll for live stats. */
function useEverVisible(): [(element: HTMLDivElement | null) => void, boolean] {
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
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
    }, [element, seen]);
    return [setElement, seen];
}

/** One metric: icon, the live value, and the limit under it. Turns red at 90 percent of the limit. */
function Metric({
    icon: Icon,
    label,
    value,
    limit,
    alarm,
}: {
    icon: typeof Cpu;
    label: string;
    value: string;
    limit: string;
    alarm: boolean;
}) {
    const danger = alarm ? 'rgb(var(--gb-danger))' : undefined;

    return (
        <div className={'gb-metric'} aria-label={label}>
            <Icon aria-hidden style={{ color: danger }} />
            <span>
                <strong style={{ color: danger }}>{value}</strong>
                <small>of {limit}</small>
            </span>
        </div>
    );
}

const alarmed = (current: number, limitMiB: number) => limitMiB > 0 && current / (limitMiB * 1024 * 1024) >= 0.9;

function StatusNote({ status }: { status: string }) {
    const text =
        status === 'suspended'
            ? 'Suspended'
            : status === 'installing'
              ? 'Installing'
              : status === 'install_failed'
                ? 'Install failed'
                : 'Unavailable';
    const tone = status === 'installing' ? 'warning' : 'danger';

    return <span className={`gb-badge gb-badge-${tone}`}>{text}</span>;
}

interface Live {
    attributes: {
        current_state: string;
        resources: { cpu_absolute: number; memory_bytes: number; disk_bytes: number };
    };
}

/** Polls the live numbers; only mounted for a row that has been on screen. */
function LiveBody({ instance }: { instance: Instance }) {
    const { data } = useServerResources(instance.uuid);

    return <RowDetails instance={instance} live={data as Live | undefined} />;
}

function RowBody({ instance, visible }: { instance: Instance; visible: boolean }) {
    return visible && instance.status === null ? (
        <LiveBody instance={instance} />
    ) : (
        <RowDetails instance={instance} live={undefined} />
    );
}

function RowDetails({ instance, live }: { instance: Instance; live: Live | undefined }) {
    const unavailable = instance.status !== null;
    const state = (live?.attributes.current_state ?? null) as PowerState | null;
    const resources = live?.attributes.resources;
    const dot = unavailable ? 'gb-dot-' + (instance.status === 'installing' ? 'warning' : 'danger') : dotClass(state);
    const label = state ? STATE_LABEL[state] : 'Checking';

    return (
        <>
            <span className={'gb-server-name'}>
                <span className={'gb-server-title'}>
                    <span className={'gb-dot ' + dot} role={'img'} aria-label={label} title={label} />
                    <strong>{instance.name}</strong>
                    {unavailable && <StatusNote status={instance.status ?? ''} />}
                </span>
                {!!instance.description && <span className={'gb-server-desc'}>{instance.description}</span>}
            </span>
            <span className={'gb-server-where'}>
                <strong>{instance.node ?? 'No node'}</strong>
                <small>{instance.address ?? 'No allocation'}</small>
            </span>
            {resources && !unavailable ? (
                <span className={'gb-server-stats'}>
                    <Metric
                        icon={Cpu}
                        label={'CPU'}
                        value={formatCpu(resources.cpu_absolute)}
                        limit={instance.limits.cpu === 0 ? 'Unlimited' : `${instance.limits.cpu} %`}
                        alarm={instance.limits.cpu > 0 && resources.cpu_absolute >= instance.limits.cpu * 0.9}
                    />
                    <Metric
                        icon={MemoryStick}
                        label={'Memory'}
                        value={formatBytes(resources.memory_bytes)}
                        limit={formatLimit(instance.limits.memory)}
                        alarm={alarmed(resources.memory_bytes, instance.limits.memory)}
                    />
                    <Metric
                        icon={HardDrive}
                        label={'Storage'}
                        value={formatBytes(resources.disk_bytes)}
                        limit={formatLimit(instance.limits.disk)}
                        alarm={alarmed(resources.disk_bytes, instance.limits.disk)}
                    />
                </span>
            ) : (
                <span className={'gb-server-stats gb-muted'}>
                    <span
                        className={'gb-skeleton'}
                        style={{ height: 14, width: '60%', display: unavailable ? 'none' : 'block' }}
                    />
                </span>
            )}
        </>
    );
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
    const iconStyle: CSSProperties | undefined = color
        ? { color, background: color + '1f', borderColor: color + '55' }
        : undefined;

    const items: ReactNode = (
        <>
            <PanelLink destination={destination} className={'contents'}>
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
                    visibleRef(element);
                }}
                data-instance={instance.uuid}
                className={'gb-server-item' + (dragging ? ' dragging' : '')}
            >
                <div className={'gb-grip'}>
                    <button
                        type={'button'}
                        aria-label={`Reorder ${instance.name}. Press Space to pick up, then use the arrow keys.`}
                        title={'Drag to reorder'}
                        {...drag.handleProps(instance.uuid)}
                        style={{ touchAction: 'none', cursor: 'grab' }}
                    >
                        <GripVertical aria-hidden />
                    </button>
                </div>
                <PanelLink destination={destination} className={'gb-server-row'} aria-label={instance.name}>
                    <span className={'gb-file-icon'} style={iconStyle} aria-hidden>
                        <ServerIcon />
                    </span>
                    <RowBody instance={instance} visible={visible} />
                </PanelLink>
                <DropdownMenu
                    triggerContent={<Ellipsis aria-label={`Actions for ${instance.name}`} />}
                    triggerClassName={'gb-icon-btn gb-icon-btn-sm gb-row-more'}
                >
                    {items}
                </DropdownMenu>
            </div>
        </ContextDropdownMenu>
    );
}

export default memo(InstanceRow);
