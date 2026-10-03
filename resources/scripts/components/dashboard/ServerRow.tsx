import React, { memo, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, HardDrive, MemoryStick, Server as ServerIcon } from 'lucide-react';
import { Server } from '@/api/server/getServer';
import getServerResourceUsage, { ServerStats } from '@/api/server/getServerResourceUsage';
import { bytesToString, ip, mbToBytes } from '@/lib/formatters';
import isEqual from 'react-fast-compare';

// Determines if the current value is in an alarm threshold so it can be shown in red rather
// than the more faded default style.
const isAlarmState = (current: number, limit: number): boolean => limit > 0 && current / (limit * 1024 * 1024) >= 0.9;

type Timer = ReturnType<typeof setInterval>;

const Stat = memo(
    ({
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
    }) => (
        <div className={'gb-metric'} aria-label={label}>
            <Icon aria-hidden style={{ color: alarm ? 'rgb(var(--gb-danger))' : undefined }} />
            <span>
                <strong style={{ color: alarm ? 'rgb(var(--gb-danger))' : undefined }}>{value}</strong>
                <small>of {limit}</small>
            </span>
        </div>
    ),
    isEqual
);
Stat.displayName = 'Stat';

// One instance in the list: status, name and description, node and address, then live CPU / memory / storage.
export default ({ server, className }: { server: Server; className?: string }) => {
    const interval = useRef<Timer>(null) as React.MutableRefObject<Timer>;
    const [isSuspended, setIsSuspended] = useState(server.status === 'suspended');
    const [stats, setStats] = useState<ServerStats | null>(null);

    const getStats = () =>
        getServerResourceUsage(server.uuid)
            .then((data) => setStats(data))
            .catch((error) => console.error(error));

    useEffect(() => {
        setIsSuspended(stats?.isSuspended || server.status === 'suspended');
    }, [stats?.isSuspended, server.status]);

    useEffect(() => {
        // No need for a request when there is nothing to show because the server is suspended.
        if (isSuspended || server.isNodeUnderMaintenance) return;

        getStats();
        interval.current = setInterval(() => {
            // Background tabs do not need live usage numbers.
            if (!document.hidden) getStats();
        }, 30000);

        return () => {
            interval.current && clearInterval(interval.current);
        };
    }, [isSuspended, server.isNodeUnderMaintenance]);

    const alarms = { cpu: false, memory: false, disk: false };
    if (stats) {
        alarms.cpu = server.limits.cpu === 0 ? false : stats.cpuUsagePercent >= server.limits.cpu * 0.9;
        alarms.memory = isAlarmState(stats.memoryUsageInBytes, server.limits.memory);
        alarms.disk = server.limits.disk === 0 ? false : isAlarmState(stats.diskUsageInBytes, server.limits.disk);
    }

    const diskLimit = server.limits.disk !== 0 ? bytesToString(mbToBytes(server.limits.disk)) : 'Unlimited';
    const memoryLimit = server.limits.memory !== 0 ? bytesToString(mbToBytes(server.limits.memory)) : 'Unlimited';
    const cpuLimit = server.limits.cpu !== 0 ? server.limits.cpu + ' %' : 'Unlimited';
    const allocation = server.allocations.find((alloc) => alloc.isDefault);

    const note = isSuspended
        ? { tone: 'danger', text: server.status === 'suspended' ? 'Suspended' : 'Connection error' }
        : server.isNodeUnderMaintenance
        ? { tone: 'warning', text: 'Maintenance' }
        : server.isTransferring || server.status
        ? {
              tone: 'warning',
              text: server.isTransferring
                  ? 'Transferring'
                  : server.status === 'installing'
                  ? 'Installing'
                  : server.status === 'restoring_backup'
                  ? 'Restoring backup'
                  : 'Unavailable',
          }
        : null;

    const power = stats?.status;
    const dot = note
        ? 'gb-dot-' + note.tone
        : power === 'running'
        ? 'gb-dot-success'
        : power === 'offline' || !power
        ? ''
        : 'gb-dot-warning';

    return (
        <Link to={`/server/${server.id}`} className={'gb-server-row ' + (className || '')}>
            <span className={'gb-file-icon'}>
                <ServerIcon aria-hidden />
            </span>
            <span className={'gb-server-name'}>
                <span className={'gb-server-title'}>
                    <span
                        className={'gb-dot ' + dot}
                        role={'img'}
                        aria-label={note?.text || power || 'offline'}
                        title={note?.text || power || 'offline'}
                    />
                    <strong>{server.name}</strong>
                    {note && <span className={'gb-badge gb-badge-' + note.tone}>{note.text}</span>}
                </span>
                {!!server.description && <span className={'gb-server-desc'}>{server.description}</span>}
            </span>
            <span className={'gb-server-where'}>
                <strong>{server.node}</strong>
                <small>
                    {allocation ? `${allocation.alias || ip(allocation.ip)}:${allocation.port}` : 'No allocation'}
                </small>
            </span>
            {stats && !isSuspended && !server.isNodeUnderMaintenance ? (
                <span className={'gb-server-stats'}>
                    <Stat
                        icon={Cpu}
                        label={'CPU'}
                        value={`${stats.cpuUsagePercent.toFixed(1)} %`}
                        limit={cpuLimit}
                        alarm={alarms.cpu}
                    />
                    <Stat
                        icon={MemoryStick}
                        label={'Memory'}
                        value={bytesToString(stats.memoryUsageInBytes)}
                        limit={memoryLimit}
                        alarm={alarms.memory}
                    />
                    <Stat
                        icon={HardDrive}
                        label={'Storage'}
                        value={bytesToString(stats.diskUsageInBytes)}
                        limit={diskLimit}
                        alarm={alarms.disk}
                    />
                </span>
            ) : (
                <span className={'gb-server-stats gb-muted'}>
                    <span
                        className={'gb-skeleton'}
                        style={{ height: 14, width: '60%', display: note ? 'none' : 'block' }}
                    />
                </span>
            )}
        </Link>
    );
};
