import { describe, expect, it } from 'vitest';
import { dotView, levelOf, modeOf } from './levels';

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

describe('what the instance is doing', () => {
    it('maps the power state and the instance status to a mode', () => {
        expect(modeOf('running', null)).toBe('running');
        expect(modeOf('starting', null)).toBe('transition');
        expect(modeOf('stopping', null)).toBe('transition');
        expect(modeOf('offline', null)).toBe('offline');
        expect(modeOf('stopped', null)).toBe('offline');
        expect(modeOf(null, null)).toBe('checking');
        expect(modeOf('running', 'installing')).toBe('installing');
        expect(modeOf('offline', 'suspended')).toBe('unavailable');
    });
});

describe('dots', () => {
    it('flash in the colour of their level while running, red included', () => {
        expect(dotView('running', 'ok')).toEqual({ level: 'ok', flashing: true });
        expect(dotView('running', 'high')).toEqual({ level: 'high', flashing: true });
        expect(dotView('running', 'max')).toEqual({ level: 'max', flashing: true });
        expect(dotView('running', 'idle')).toEqual({ level: 'ok', flashing: true });
    });

    it('flash yellow while changing and grey while unknown', () => {
        expect(dotView('transition', 'ok')).toEqual({ level: 'high', flashing: true });
        expect(dotView('installing', 'ok')).toEqual({ level: 'high', flashing: true });
        expect(dotView('checking', 'ok')).toEqual({ level: 'idle', flashing: true });
    });

    it('hold still, and red, only when the instance is off or unavailable', () => {
        for (const mode of ['offline', 'unavailable'] as const) {
            for (const own of ['idle', 'ok', 'high', 'max'] as const) {
                expect(dotView(mode, own)).toEqual({ level: 'max', flashing: false });
            }
        }
    });
});
