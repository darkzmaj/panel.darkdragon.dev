const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Human readable size with one decimal above 10 and two below, e.g. 1.25 GiB, 512 MiB. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** exponent;
    const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${Number(value.toFixed(digits))} ${UNITS[exponent]}`;
}

/** A limit in MiB (0 means unlimited) as text. */
export function formatLimit(megabytes: number): string {
    return megabytes === 0 ? 'Unlimited' : formatBytes(megabytes * 1024 * 1024);
}

export function formatCpu(percent: number): string {
    return `${Number(percent.toFixed(percent >= 100 ? 0 : 1))}%`;
}
