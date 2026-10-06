const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** exponent;
    const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${Number(value.toFixed(digits))} ${UNITS[exponent]}`;
}
