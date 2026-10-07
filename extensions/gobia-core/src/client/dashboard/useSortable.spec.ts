import { describe, expect, it } from 'vitest';
import { moveItem } from './useSortable';

describe('moveItem', () => {
    it('moves an item to a new index without mutating the input', () => {
        const input = ['a', 'b', 'c', 'd'];
        expect(moveItem(input, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
        expect(moveItem(input, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
        expect(input).toEqual(['a', 'b', 'c', 'd']);
    });

    it('returns a copy for a no-op or an out of range target', () => {
        const input = ['a', 'b'];
        expect(moveItem(input, 1, 1)).toEqual(input);
        expect(moveItem(input, 0, 5)).toEqual(input);
        expect(moveItem(input, 0, -1)).toEqual(input);
        expect(moveItem(input, 0, 5)).not.toBe(input);
    });
});
