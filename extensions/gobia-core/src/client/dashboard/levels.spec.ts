import { describe, expect, it } from 'vitest';
import { levelOf, powerLevel } from './levels';

describe('resource levels', () => {
    it('is grey when there is nothing to measure and normal without a limit', () => {
        expect(levelOf(null, 100)).toBe('idle');
        expect(levelOf(Number.NaN, 100)).toBe('idle');
        expect(levelOf(5000, 0)).toBe('ok');
    });

    it('turns yellow when high and red at or over the limit', () => {
        expect(levelOf(10, 100)).toBe('ok');
        expect(levelOf(74, 100)).toBe('ok');
        expect(levelOf(75, 100)).toBe('high');
        expect(levelOf(94, 100)).toBe('high');
        expect(levelOf(95, 100)).toBe('max');
        expect(levelOf(250, 100)).toBe('max');
    });
});

describe('power level', () => {
    it('flashes only while the instance is up or changing', () => {
        expect(powerLevel('running')).toEqual({ level: 'ok', flashing: true });
        expect(powerLevel('starting')).toEqual({ level: 'high', flashing: true });
        expect(powerLevel('stopping')).toEqual({ level: 'high', flashing: true });
        expect(powerLevel('offline')).toEqual({ level: 'idle', flashing: false });
        expect(powerLevel(null)).toEqual({ level: 'idle', flashing: false });
        expect(powerLevel('running', true)).toEqual({ level: 'max', flashing: false });
    });
});
