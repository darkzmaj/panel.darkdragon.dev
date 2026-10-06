import { describe, expect, it } from 'vitest';
import { indexForPointer, move, sameOrder } from './order';

describe('order', () => {
    it('moves an item without mutating the input', () => {
        const input = ['a', 'b', 'c', 'd'];
        expect(move(input, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
        expect(move(input, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
        expect(input).toEqual(['a', 'b', 'c', 'd']);
    });

    it('clamps targets and ignores an unknown source', () => {
        expect(move(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
        expect(move(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
        expect(move(['a', 'b'], 7, 0)).toEqual(['a', 'b']);
        expect(move([], 0, 0)).toEqual([]);
    });

    it('finds the drop index from the row centres', () => {
        const centers = [20, 60, 100, 140];
        expect(indexForPointer(centers, 0)).toBe(0);
        expect(indexForPointer(centers, 45)).toBe(1);
        expect(indexForPointer(centers, 99)).toBe(2);
        expect(indexForPointer(centers, 500)).toBe(3);
        expect(indexForPointer([], 10)).toBe(0);
    });

    it('compares orders', () => {
        expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
        expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
    });
});
