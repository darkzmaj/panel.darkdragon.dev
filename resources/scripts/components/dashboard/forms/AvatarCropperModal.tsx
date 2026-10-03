import React, { useCallback, useEffect, useRef, useState } from 'react';
import tw from 'twin.macro';
import Modal from '@/components/elements/Modal';
import { Button } from '@/components/elements/button/index';

interface Props {
    file: File | null;
    onCancel: () => void;
    onConfirm: (cropped: File) => void;
}

// Edge length of the square crop window on screen, and the largest image that is exported.
const VIEW = 280;
const MAX_OUTPUT = 512;
const MAX_ZOOM = 4;

interface Point {
    x: number;
    y: number;
}

// Draws the exact circular result at a given size so the user sees what will be displayed.
const Preview = ({
    image,
    offset,
    scale,
    size,
}: {
    image: HTMLImageElement | null;
    offset: Point;
    scale: number;
    size: number;
}) => {
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const el = canvas.current;
        if (!el || !image || !image.complete) return;

        const ctx = el.getContext('2d')!;
        const side = VIEW / scale;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(image, -offset.x / scale, -offset.y / scale, side, side, 0, 0, size, size);
    });

    return (
        <canvas
            ref={canvas}
            width={size}
            height={size}
            aria-hidden
            style={{ width: size, height: size, borderRadius: '50%' }}
            css={tw`bg-neutral-600 mr-3`}
        />
    );
};

// Lets the user position and zoom a PNG inside a square window and produces the cropped PNG.
// The server still validates and re-encodes whatever is uploaded; this only decides what is kept.
export default ({ file, onCancel, onConfirm }: Props) => {
    const [url, setUrl] = useState<string | null>(null);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
    const [error, setError] = useState<string | null>(null);
    const drag = useRef<{ pointer: Point; origin: Point } | null>(null);
    const image = useRef<HTMLImageElement>(null);

    useEffect(() => {
        if (!file) {
            setUrl(null);
            setNatural(null);

            return;
        }

        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        setZoom(1);
        setError(null);

        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    const baseScale = natural ? VIEW / Math.min(natural.w, natural.h) : 1;
    const scale = baseScale * zoom;

    // Keeps the image covering the whole window so the crop never contains empty space.
    const clamp = useCallback(
        (point: Point, forScale = scale): Point => {
            if (!natural) return point;

            return {
                x: Math.min(0, Math.max(VIEW - natural.w * forScale, point.x)),
                y: Math.min(0, Math.max(VIEW - natural.h * forScale, point.y)),
            };
        },
        [natural, scale]
    );

    const onLoad = () => {
        const el = image.current!;
        const w = el.naturalWidth;
        const h = el.naturalHeight;
        const s = VIEW / Math.min(w, h);
        setNatural({ w, h });
        setOffset({ x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 });
    };

    // Zoom around the centre of the window so the picture does not jump.
    const changeZoom = (next: number) => {
        const value = Math.min(MAX_ZOOM, Math.max(1, next));
        const ratio = (baseScale * value) / scale;
        setZoom(value);
        setOffset((o) =>
            clamp({ x: VIEW / 2 - (VIEW / 2 - o.x) * ratio, y: VIEW / 2 - (VIEW / 2 - o.y) * ratio }, baseScale * value)
        );
    };

    const onPointerDown = (e: React.PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointer: { x: e.clientX, y: e.clientY }, origin: offset };
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!drag.current) return;
        const { pointer, origin } = drag.current;
        setOffset(clamp({ x: origin.x + e.clientX - pointer.x, y: origin.y + e.clientY - pointer.y }));
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = 12;
        const moves: Record<string, Point> = {
            ArrowLeft: { x: step, y: 0 },
            ArrowRight: { x: -step, y: 0 },
            ArrowUp: { x: 0, y: step },
            ArrowDown: { x: 0, y: -step },
        };

        if (moves[e.key]) {
            e.preventDefault();
            setOffset((o) => clamp({ x: o.x + moves[e.key].x, y: o.y + moves[e.key].y }));
        } else if (e.key === '+' || e.key === '=') {
            changeZoom(zoom + 0.2);
        } else if (e.key === '-') {
            changeZoom(zoom - 0.2);
        }
    };

    const confirm = () => {
        if (!natural || !image.current) return;

        const side = VIEW / scale; // edge of the kept square, in source pixels
        const output = Math.max(1, Math.min(MAX_OUTPUT, Math.round(side)));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = output;
        canvas
            .getContext('2d')!
            .drawImage(image.current, -offset.x / scale, -offset.y / scale, side, side, 0, 0, output, output);

        canvas.toBlob((blob) => {
            if (!blob) {
                setError('The image could not be cropped.');

                return;
            }
            onConfirm(new File([blob], 'avatar.png', { type: 'image/png' }));
        }, 'image/png');
    };

    return (
        <Modal visible={!!file} onDismissed={onCancel} dismissable closeOnEscape closeOnBackground>
            <h2 css={tw`text-2xl mb-4 text-neutral-100`}>Adjust your profile picture</h2>
            <p css={tw`text-sm text-neutral-300 mb-4`}>Drag the image to reposition it and use the slider to zoom.</p>
            <div css={tw`flex flex-col sm:flex-row items-center sm:items-start`}>
                <div
                    role={'application'}
                    aria-label={'Crop area. Use arrow keys to move the image and plus or minus to zoom.'}
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => (drag.current = null)}
                    onPointerCancel={() => (drag.current = null)}
                    onWheel={(e) => changeZoom(zoom - Math.sign(e.deltaY) * 0.1)}
                    style={{ width: VIEW, height: VIEW, touchAction: 'none', cursor: 'grab' }}
                    css={tw`relative flex-none overflow-hidden bg-neutral-900 rounded focus:outline-none focus:ring-2 focus:ring-cyan-600`}
                >
                    {url && (
                        <img
                            ref={image}
                            src={url}
                            alt={''}
                            draggable={false}
                            onLoad={onLoad}
                            onError={() => setError('That file could not be read as an image.')}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                maxWidth: 'none',
                                width: natural ? natural.w * scale : undefined,
                                height: natural ? natural.h * scale : undefined,
                                transform: `translate(${offset.x}px, ${offset.y}px)`,
                                userSelect: 'none',
                            }}
                        />
                    )}
                    {/* Dim everything outside the circle that will be displayed. */}
                    <div
                        aria-hidden
                        style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            boxShadow: '0 0 0 999px rgba(0, 0, 0, 0.55)',
                            border: '2px solid rgba(255, 255, 255, 0.8)',
                            pointerEvents: 'none',
                        }}
                    />
                </div>
                <div css={tw`sm:ml-6 mt-4 sm:mt-0 flex-1 w-full`}>
                    <label htmlFor={'avatar-zoom'} css={tw`block text-xs uppercase text-neutral-300 mb-1`}>
                        Zoom
                    </label>
                    <input
                        id={'avatar-zoom'}
                        type={'range'}
                        min={1}
                        max={MAX_ZOOM}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => changeZoom(Number(e.currentTarget.value))}
                        css={tw`w-full`}
                    />
                    <p css={tw`text-xs uppercase text-neutral-300 mt-4 mb-2`}>Preview</p>
                    <div css={tw`flex items-end`}>
                        <Preview image={image.current} offset={offset} scale={scale} size={72} />
                        <Preview image={image.current} offset={offset} scale={scale} size={32} />
                    </div>
                </div>
            </div>
            {error && <p css={tw`text-sm text-red-400 mt-4`}>{error}</p>}
            <div css={tw`flex justify-end mt-6`}>
                <Button.Text type={'button'} onClick={onCancel} css={tw`mr-2`}>
                    Cancel
                </Button.Text>
                <Button type={'button'} onClick={confirm} disabled={!natural || !!error}>
                    Save picture
                </Button>
            </div>
        </Modal>
    );
};
