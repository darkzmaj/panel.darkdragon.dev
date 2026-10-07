import { Button, Dialog } from '@pterodactyl/sdk';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_ZOOM, MIN_ZOOM, normalise, scaleFor, sourceRect, type CropState } from './cropMath';

const VIEWPORT = 280;
const OUTPUT = 256;
const KEY_STEP = 12;

/** The exact circular result at a given size, redrawn live, so the user sees what the picture will look like. */
function Preview({ image, rect, size }: { image: HTMLImageElement | null; rect: { x: number; y: number; size: number } | null; size: number }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const context = canvas.current?.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, size, size);
        if (image && rect) context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, size, size);
    });
    return (
        <canvas
            ref={canvas}
            width={size}
            height={size}
            aria-hidden
            style={{ width: size, height: size, borderRadius: '50%', background: 'var(--gb-surface-2)' }}
        />
    );
}

/** How an arrow key moves the image, or null for any other key. */
function keyboardMove(key: string): [number, number] | null {
    switch (key) {
        case 'ArrowLeft':
            return [KEY_STEP, 0];
        case 'ArrowRight':
            return [-KEY_STEP, 0];
        case 'ArrowUp':
            return [0, KEY_STEP];
        case 'ArrowDown':
            return [0, -KEY_STEP];
        default:
            return null;
    }
}

interface Props {
    /** The picked image file. */
    file: File;
    onCancel: () => void;
    /** Receives the cropped 256 pixel square as a PNG. */
    onApply: (png: Blob) => void | Promise<void>;
}

/** Direct manipulation cropper: drag the image, use the slider, the mouse wheel or the keyboard (arrows and plus/minus). */
export default function AvatarCropper({ file, onCancel, onApply }: Props) {
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [crop, setCrop] = useState<Pick<CropState, 'zoom' | 'offsetX' | 'offsetY'>>({
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
    });
    const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const viewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const url = URL.createObjectURL(file);
        const element = new Image();
        element.onload = () => setImage(element);
        element.onerror = () => setFailed(true);
        element.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const state = useMemo<CropState | null>(
        () =>
            image
                ? normalise({
                      viewport: VIEWPORT,
                      imageWidth: image.naturalWidth,
                      imageHeight: image.naturalHeight,
                      ...crop,
                  })
                : null,
        [image, crop]
    );

    const update = useCallback(
        (next: Partial<Pick<CropState, 'zoom' | 'offsetX' | 'offsetY'>>) => {
            if (!image) return;
            setCrop((current) => {
                const merged = normalise({
                    viewport: VIEWPORT,
                    imageWidth: image.naturalWidth,
                    imageHeight: image.naturalHeight,
                    ...current,
                    ...next,
                });
                return { zoom: merged.zoom, offsetX: merged.offsetX, offsetY: merged.offsetY };
            });
        },
        [image]
    );

    // React attaches wheel listeners as passive, so scrolling the page would win; attach one that can prevent it.
    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            setCrop((current) => ({ ...current, zoom: current.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08) }));
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [image]);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, ox: crop.offsetX, oy: crop.offsetY };
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start) return;
        update({ offsetX: start.ox + event.clientX - start.x, offsetY: start.oy + event.clientY - start.y });
    };
    const onPointerUp = () => {
        drag.current = null;
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const move = keyboardMove(event.key);
        if (move) {
            event.preventDefault();
            update({ offsetX: crop.offsetX + move[0], offsetY: crop.offsetY + move[1] });
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            update({ zoom: crop.zoom * 1.1 });
        } else if (event.key === '-') {
            event.preventDefault();
            update({ zoom: crop.zoom / 1.1 });
        }
    };

    const apply = async () => {
        if (!image || !state) return;
        const rect = sourceRect(state);
        const canvas = document.createElement('canvas');
        canvas.width = OUTPUT;
        canvas.height = OUTPUT;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, OUTPUT, OUTPUT);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;
        setBusy(true);
        try {
            await onApply(blob);
        } finally {
            setBusy(false);
        }
    };

    const scale = state ? scaleFor(state) : 1;
    const rect = state ? sourceRect(state) : null;

    return (
        <Dialog
            open
            onClose={busy ? () => {} : onCancel}
            title={'Crop your avatar'}
            description={'Drag to move, scroll or use the slider to zoom.'}
        >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                {failed ? (
                    <p className={'gb:text-sm gb:text-destructive'}>This file could not be read as an image.</p>
                ) : (
                    <div
                        ref={viewportRef}
                        role={'group'}
                        aria-label={'Avatar crop area. Use the arrow keys to move and plus or minus to zoom.'}
                        tabIndex={0}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onKeyDown={onKeyDown}
                        style={{ width: VIEWPORT, height: VIEWPORT, touchAction: 'none' }}
                        className={
                            'gb:relative gb:cursor-grab gb:overflow-hidden gb:rounded-full gb:border gb:border-border gb:bg-sunken gb:outline-none gb:focus-visible:ring-2 gb:focus-visible:ring-ring gb:active:cursor-grabbing'
                        }
                    >
                        {image && state && (
                            <img
                                src={image.src}
                                alt={''}
                                draggable={false}
                                style={{
                                    position: 'absolute',
                                    left: VIEWPORT / 2 + state.offsetX - (image.naturalWidth * scale) / 2,
                                    top: VIEWPORT / 2 + state.offsetY - (image.naturalHeight * scale) / 2,
                                    width: image.naturalWidth * scale,
                                    height: image.naturalHeight * scale,
                                    maxWidth: 'none',
                                    userSelect: 'none',
                                }}
                            />
                        )}
                    </div>
                )}
                <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }} aria-label={'Preview'} role={'group'}>
                    <Preview image={image} rect={rect} size={72} />
                    <Preview image={image} rect={rect} size={40} />
                    <span className={'gb-muted'} style={{ fontSize: 12 }}>
                        Preview
                    </span>
                </div>
                <label
                    className={'gb-secondary'}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, fontSize: 13 }}
                >
                    Zoom
                    <input
                        type={'range'}
                        min={MIN_ZOOM}
                        max={MAX_ZOOM}
                        step={0.01}
                        value={state?.zoom ?? 1}
                        disabled={!state}
                        onChange={(event) => update({ zoom: Number(event.currentTarget.value) })}
                        style={{ flex: 1 }}
                    />
                </label>
            </div>
            <Dialog.Footer>
                <Button.Text type={'button'} onClick={onCancel} disabled={busy}>
                    Cancel
                </Button.Text>
                <Button type={'button'} color={'primary'} isLoading={busy} disabled={!state || busy} onClick={apply}>
                    Use this picture
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
}
