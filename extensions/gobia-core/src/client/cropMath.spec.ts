import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, normalise, sourceRect, type CropState } from './cropMath';

const base: CropState = { viewport: 200, imageWidth: 400, imageHeight: 300, zoom: 1, offsetX: 0, offsetY: 0 };

describe('cropMath', () => {
    it('shows the centred square of the shorter side at zoom 1', () => {
        const rect = sourceRect(base);
        expect(rect.size).toBeCloseTo(300);
        expect(rect.x).toBeCloseTo(50);
        expect(rect.y).toBeCloseTo(0);
    });

    it('zooming halves the visible source square', () => {
        const rect = sourceRect({ ...base, zoom: 2 });
        expect(rect.size).toBeCloseTo(150);
        expect(rect.x).toBeCloseTo(125);
        expect(rect.y).toBeCloseTo(75);
    });

    it('dragging right reveals the image to the left', () => {
        const state = normalise({ ...base, zoom: 2, offsetX: 40 });
        expect(sourceRect(state).x).toBeCloseTo(125 - 40 / ((200 / 300) * 2));
    });

    it('never lets the viewport leave the image', () => {
        const state = normalise({ ...base, zoom: 1, offsetX: 9999, offsetY: -9999 });
        const rect = sourceRect(state);
        expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.x + rect.size).toBeLessThanOrEqual(400 + 1e-9);
        expect(rect.y + rect.size).toBeLessThanOrEqual(300 + 1e-9);
        // At zoom 1 the short side already fits exactly, so only the long axis can move.
        expect(state.offsetY).toBeCloseTo(0);
    });

    it('clamps zoom to the allowed range', () => {
        expect(normalise({ ...base, zoom: 99 }).zoom).toBe(MAX_ZOOM);
        expect(normalise({ ...base, zoom: 0.1 }).zoom).toBe(1);
    });

    it('stays inside the image at every zoom and extreme drag', () => {
        for (const zoom of [1, 1.5, 2.5, 4]) {
            for (const offset of [-5000, -10, 0, 10, 5000]) {
                const state = normalise({ ...base, zoom, offsetX: offset, offsetY: -offset });
                const rect = sourceRect(state);
                expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
                expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
                expect(rect.x + rect.size).toBeLessThanOrEqual(400 + 1e-6);
                expect(rect.y + rect.size).toBeLessThanOrEqual(300 + 1e-6);
            }
        }
    });
});
