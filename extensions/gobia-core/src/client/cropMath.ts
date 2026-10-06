/** Pure geometry for the avatar cropper: a square viewport over an image that can be zoomed and dragged. */

export interface CropState {
    /** Viewport edge in CSS pixels. */
    viewport: number;
    imageWidth: number;
    imageHeight: number;
    /** 1 shows the image just covering the viewport; larger zooms in. */
    zoom: number;
    /** Offset of the image centre from the viewport centre, in CSS pixels. */
    offsetX: number;
    offsetY: number;
}

export interface Offset {
    x: number;
    y: number;
}

export interface SourceRect {
    x: number;
    y: number;
    size: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Pixels the image is scaled by at the given zoom. */
export function scaleFor(state: Pick<CropState, 'viewport' | 'imageWidth' | 'imageHeight' | 'zoom'>): number {
    return (state.viewport / Math.min(state.imageWidth, state.imageHeight)) * state.zoom;
}

/** Largest offset in each axis that still leaves the viewport fully covered by the image. */
export function maxOffset(state: Pick<CropState, 'viewport' | 'imageWidth' | 'imageHeight' | 'zoom'>): Offset {
    const scale = scaleFor(state);
    return {
        x: Math.max(0, (state.imageWidth * scale - state.viewport) / 2),
        y: Math.max(0, (state.imageHeight * scale - state.viewport) / 2),
    };
}

/** Keeps the zoom in range and the offset inside the image. */
export function normalise(state: CropState): CropState {
    const zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
    const limit = maxOffset({ ...state, zoom });
    return {
        ...state,
        zoom,
        offsetX: clamp(state.offsetX, -limit.x, limit.x),
        offsetY: clamp(state.offsetY, -limit.y, limit.y),
    };
}

/** The square of the source image, in image pixels, that is currently visible in the viewport. */
export function sourceRect(state: CropState): SourceRect {
    const scale = scaleFor(state);
    const left = state.viewport / 2 + state.offsetX - (state.imageWidth * scale) / 2;
    const top = state.viewport / 2 + state.offsetY - (state.imageHeight * scale) / 2;
    return { x: -left / scale, y: -top / scale, size: state.viewport / scale };
}
