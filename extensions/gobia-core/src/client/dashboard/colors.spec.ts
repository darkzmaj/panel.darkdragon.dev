import { describe, expect, it } from 'vitest';
import { luminance, normaliseHex, PRESETS, readableOn } from './colors';

describe('colors', () => {
    it('validates and lower cases hex colours', () => {
        expect(normaliseHex('#AABBCC')).toBe('#aabbcc');
        expect(normaliseHex('  #1264d1 ')).toBe('#1264d1');
        for (const bad of ['', 'red', '#abc', '#12345', '#1234567', '#12345g', 'url(x)', '#aabbcc;']) {
            expect(normaliseHex(bad)).toBeNull();
        }
    });

    it('every preset is a valid colour', () => {
        for (const preset of PRESETS) expect(normaliseHex(preset)).toBe(preset);
    });

    it('computes luminance at the extremes', () => {
        expect(luminance('#000000')).toBeCloseTo(0);
        expect(luminance('#ffffff')).toBeCloseTo(1);
    });

    it('picks a readable foreground', () => {
        expect(readableOn('#ffffff')).toBe('#000000');
        expect(readableOn('#eab308')).toBe('#000000');
        expect(readableOn('#0f172a')).toBe('#ffffff');
        expect(readableOn('#1264d1')).toBe('#ffffff');
    });
});
