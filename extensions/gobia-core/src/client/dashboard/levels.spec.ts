import { describe, expect, it } from 'vitest';
import { FLASH_MS, dotView, flashTiming, levelOf, modeOf } from './levels';

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

describe('flash timing', () => {
    const dots = ['power', 'cpu', 'memory', 'disk'];

    it('is the same wherever the dot is drawn, whatever the time', () => {
        for (const dot of dots) {
            expect(flashTiming('abc', dot, 1000).duration).toBe(flashTiming('abc', dot, 987654).duration);
        }
    });

    it('gives the four dots of an instance four different speeds and phases', () => {
        for (const seed of [
            'a',
            'b',
            'e5e0f441-83b7-4d09-8358-add2f1b5dc0a',
            '2b99681f-1687-4309-84bd-17d43b27a880',
            'x'.repeat(40),
        ]) {
            const timings = dots.map((dot) => flashTiming(seed, dot, 5000));
            expect(new Set(timings.map((timing) => timing.duration)).size).toBe(4);
            expect(timings.every((timing) => FLASH_MS.includes(timing.duration as (typeof FLASH_MS)[number]))).toBe(
                true
            );
            expect(timings.every((timing) => timing.delay >= 0 && timing.delay < timing.duration)).toBe(true);
        }
    });

    it('spreads instances over every speed', () => {
        const seen = new Set<number>();
        for (let index = 0; index < 60; index++) seen.add(flashTiming(`server-${index}`, 'power', 0).duration);
        expect(seen.size).toBe(FLASH_MS.length);
    });
});
