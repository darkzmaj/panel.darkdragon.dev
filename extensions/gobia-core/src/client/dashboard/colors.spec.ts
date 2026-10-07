import { describe, expect, it } from 'vitest';
import { normaliseHex } from './colors';

describe('normaliseHex', () => {
    it('lower cases and accepts #rrggbb only', () => {
        expect(normaliseHex('#1264D1')).toBe('#1264d1');
        expect(normaliseHex('  #abcdef ')).toBe('#abcdef');
    });

    it.each(['', '#fff', '1264d1', '#12345g', '#1264d1ff', 'red'])('rejects %j', (value) => {
        expect(normaliseHex(value)).toBeNull();
    });
});
