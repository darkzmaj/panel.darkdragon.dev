import { describe, expect, it } from 'vitest';
import { formatBytes, formatCpu, formatLimit } from './format';

describe('format', () => {
    it('formats byte sizes', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(-5)).toBe('0 B');
        expect(formatBytes(NaN)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1536)).toBe('1.5 KiB');
        expect(formatBytes(512 * 1024 * 1024)).toBe('512 MiB');
        expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.25 GiB');
        expect(formatBytes(12.5 * 1024 ** 3)).toBe('12.5 GiB');
        expect(formatBytes(5 * 1024 ** 4)).toBe('5 TiB');
    });

    it('formats limits, treating zero as unlimited', () => {
        expect(formatLimit(0)).toBe('Unlimited');
        expect(formatLimit(1024)).toBe('1 GiB');
    });

    it('formats cpu', () => {
        expect(formatCpu(0)).toBe('0%');
        expect(formatCpu(12.345)).toBe('12.3%');
        expect(formatCpu(250.9)).toBe('251%');
    });
});
