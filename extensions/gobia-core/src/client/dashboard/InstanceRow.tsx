import { PanelLink, useServerResources } from '@pterodactyl/sdk';
import { Ellipsis, GripVertical, Server as ServerIcon } from 'lucide-react';
import { memo, useEffect, useState, type CSSProperties } from 'react';
import { formatBytes, formatCpu, formatLimit } from './format';
import { levelOf, modeOf } from './levels';
import { useLiveStats, type Live } from './liveStats';
import StatusDots from './StatusDots';
import type { useSortable } from './useSortable';
import type { Instance } from './types';

type PowerState = 'offline' | 'stopped' | 'starting' | 'running' | 'stopping';

const STATE_LABEL = {
    offline: 'Offline',
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
} satisfies Record<PowerState, string>;

/** True once the element has been on screen, so off screen rows never poll for live stats. */
function useEverVisible(): [(element: HTMLElement | null) => void, boolean] {
    const [element, setElement] = useState<HTMLElement | null>(null);
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

/** One metric: the live value, and the limit under it. Turns red at 90 percent of the limit. */
function Metric({ label, value, limit, alarm }: { label: string; value: string; limit: string; alarm: boolean }) {
    const danger = alarm ? 'rgb(var(--gb-danger))' : undefined;

    return (
        <div className={'gb-metric'} aria-label={label}>
            <strong style={{ color: danger }}>{value}</strong>
            <small>of {limit}</small>
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

/** Pushed numbers win over the polled ones; until the first frame the polled ones show. */
function LiveBody({ instance }: { instance: Instance }) {
    const { data } = useServerResources(instance.uuid);
    const pushed = useLiveStats(instance.uuid);
    const polled = data as
        | {
              attributes: {
                  current_state: string;
                  resources: { cpu_absolute: number; memory_bytes: number; disk_bytes: number };
              };
          }
        | undefined;
    const live: Live | null = polled
        ? {
              state: pushed?.state ?? polled.attributes.current_state,
              cpu: pushed ? pushed.cpu : polled.attributes.resources.cpu_absolute,
              memory: pushed ? pushed.memory : polled.attributes.resources.memory_bytes,
              disk: pushed ? pushed.disk : polled.attributes.resources.disk_bytes,
          }
        : pushed;

    return <RowDetails instance={instance} live={live} />;
}

function RowBody({ instance, visible }: { instance: Instance; visible: boolean }) {
    return visible && instance.status === null ? (
        <LiveBody instance={instance} />
    ) : (
        <RowDetails instance={instance} live={undefined} />
    );
}

function RowDetails({ instance, live }: { instance: Instance; live: Live | null | undefined }) {
    const unavailable = instance.status !== null;
    const state = (live?.state ?? null) as PowerState | null;
    const label = unavailable ? 'Unavailable' : state ? STATE_LABEL[state] : 'Checking';
    const running = state === 'running' || state === 'starting' || state === 'stopping';
    const mib = 1024 * 1024;
    const cpu = running ? (live?.cpu ?? null) : null;
    const memory = running ? (live?.memory ?? null) : null;
    const disk = live?.disk ?? null;

    return (
        <>
            <span className={'gb-server-name'}>
                <span className={'gb-server-title'}>
                    <StatusDots
                        mode={modeOf(state, instance.status)}
                        seed={instance.uuid}
                        powerLabel={label}
                        cpu={{
                            level: levelOf(cpu, instance.limits.cpu),
                            text: cpu === null ? 'not measured' : formatCpu(cpu),
                        }}
                        memory={{
                            level: levelOf(memory, instance.limits.memory * mib),
                            text: memory === null ? 'not measured' : formatBytes(memory),
                        }}
                        disk={{
                            level: levelOf(disk, instance.limits.disk * mib),
                            text: disk === null ? 'not measured' : formatBytes(disk),
                        }}
                    />
                    <strong>{instance.name}</strong>
                    {unavailable && <StatusNote status={instance.status ?? ''} />}
                </span>
                {!!instance.description && <span className={'gb-server-desc'}>{instance.description}</span>}
            </span>
            <span className={'gb-server-where'}>
                <strong>{instance.node ?? 'No node'}</strong>
                <small>{instance.address ?? 'No allocation'}</small>
            </span>
            {live && !unavailable ? (
                <span className={'gb-server-stats'}>
                    <Metric
                        label={'CPU'}
                        value={cpu === null ? '–' : formatCpu(cpu)}
                        limit={instance.limits.cpu === 0 ? 'Unlimited' : `${instance.limits.cpu} %`}
                        alarm={instance.limits.cpu > 0 && (cpu ?? 0) >= instance.limits.cpu * 0.9}
                    />
                    <Metric
                        label={'Memory'}
                        value={memory === null ? '–' : formatBytes(memory)}
                        limit={formatLimit(instance.limits.memory)}
                        alarm={alarmed(memory ?? 0, instance.limits.memory)}
                    />
                    <Metric
                        label={'Storage'}
                        value={disk === null ? '–' : formatBytes(disk)}
                        limit={formatLimit(instance.limits.disk)}
                        alarm={alarmed(disk ?? 0, instance.limits.disk)}
                    />
                </span>
            ) : (
                <span className={'gb-server-stats gb-muted'}>
                    <span
                        className={'gb-skeleton gb-stats-skeleton'}
                        style={{ display: unavailable ? 'none' : 'block' }}
                    />
                </span>
            )}
        </>
    );
}

interface Props {
    instance: Instance;
    index: number;
    sortable: ReturnType<typeof useSortable>;
    onMenu: (instance: Instance, x: number, y: number) => void;
}

function InstanceRow({ instance, index, sortable, onMenu }: Props) {
    const [visibleRef, visible] = useEverVisible();
    const color = instance.icon_color;
    const destination = { to: '/server/$id', params: { id: instance.identifier } } as const;
    const iconStyle: CSSProperties | undefined = color
        ? { color, background: color + '1f', borderColor: color + '55' }
        : undefined;
    const register = sortable.register(instance.uuid);

    return (
        <li
            ref={(element) => {
                register(element);
                visibleRef(element);
            }}
            data-instance={instance.uuid}
            className={'gb-server-item'}
            {...sortable.rowProps(instance.uuid, index)}
            onContextMenu={(event) => {
                // A touch long press is handled by the hold timers of the sortable list, never by the browser menu.
                event.preventDefault();
                if ((event.nativeEvent as PointerEvent).pointerType !== 'touch')
                    onMenu(instance, event.clientX, event.clientY);
            }}
        >
            <div className={'gb-grip'}>
                <button
                    type={'button'}
                    aria-label={`Reorder ${instance.name}. Use the up and down arrow keys, or drag.`}
                    title={'Drag to reorder'}
                    {...sortable.gripProps(instance.uuid, index)}
                    style={{ touchAction: 'none', cursor: 'grab' }}
                >
                    <GripVertical aria-hidden />
                </button>
            </div>
            <PanelLink destination={destination} className={'gb-server-row'}>
                <span className={'gb-file-icon'} style={iconStyle} aria-hidden>
                    <ServerIcon />
                </span>
                <RowBody instance={instance} visible={visible} />
            </PanelLink>
            <button
                type={'button'}
                className={'gb-icon-btn gb-icon-btn-sm gb-row-more'}
                aria-label={`Actions for ${instance.name}`}
                aria-haspopup={'menu'}
                onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    onMenu(instance, box.right, box.bottom);
                }}
            >
                <Ellipsis aria-hidden />
            </button>
        </li>
    );
}

export default memo(InstanceRow);
