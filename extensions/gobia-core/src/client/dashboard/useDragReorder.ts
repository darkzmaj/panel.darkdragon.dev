import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { indexForPointer, move, sameOrder } from './order';

const TOUCH_HOLD_MS = 400;
const TOUCH_SLOP = 8;
const EDGE = 72;

interface Options {
    ids: readonly string[];
    label: (id: string) => string;
    onCommit: (ids: string[]) => void;
}

export interface DragState {
    order: readonly string[];
    draggingId: string | null;
    /** Pointer position while a pointer drag is active, for the floating copy of the row. */
    pointer: { x: number; y: number } | null;
    announcement: string;
    rowRef: (id: string) => (element: HTMLElement | null) => void;
    handleProps: (id: string) => {
        onPointerDown: (event: PointerEvent<HTMLElement>) => void;
        onPointerMove: (event: PointerEvent<HTMLElement>) => void;
        onPointerUp: (event: PointerEvent<HTMLElement>) => void;
        onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
        onBlur: () => void;
    };
}

/**
 * Reordering with three input methods: a mouse or pen drags the handle at once, a finger holds it for a moment first (so
 * scrolling still works), and the keyboard picks the row up with Space or Enter, moves it with the arrow keys and drops
 * it with Space or Enter again (Escape cancels). Changes are previewed live and committed once on drop.
 */
export function useDragReorder({ ids, label, onCommit }: Options): DragState {
    const [preview, setPreview] = useState<string[] | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const rows = useRef(new Map<string, HTMLElement>());
    const session = useRef<{ id: string; origin: string[]; centers: number[]; keyboard: boolean } | null>(null);
    const touch = useRef<{ timer: number; x: number; y: number; id: string } | null>(null);
    const latest = useRef({ ids, label, onCommit });
    latest.current = { ids, label, onCommit };

    const order = preview ?? ids;

    const rowRef = useCallback(
        (id: string) => (element: HTMLElement | null) => {
            if (element) rows.current.set(id, element);
            else rows.current.delete(id);
        },
        []
    );

    const finish = useCallback((commit: boolean) => {
        const current = session.current;
        session.current = null;
        setDraggingId(null);
        setPointer(null);
        setPreview((shown) => {
            if (commit && current && shown && !sameOrder(shown, current.origin)) {
                latest.current.onCommit(shown);
                setAnnouncement(
                    `${latest.current.label(current.id)} moved to position ${shown.indexOf(current.id) + 1} of ${shown.length}.`
                );
            } else if (!commit && current) {
                setAnnouncement(`${latest.current.label(current.id)} stays where it was.`);
            }
            return commit && shown ? shown : null;
        });
    }, []);

    // Once fresh data arrives the preview is redundant; drop it so the server order is what is shown.
    useEffect(() => {
        if (!session.current) setPreview(null);
    }, [ids]);

    const begin = (id: string, keyboard: boolean) => {
        const origin = [...latest.current.ids];
        const centers = origin.map((rowId) => {
            const rect = rows.current.get(rowId)?.getBoundingClientRect();
            return rect ? rect.top + rect.height / 2 : 0;
        });
        session.current = { id, origin, centers, keyboard };
        setPreview(origin);
        setDraggingId(id);
        if (keyboard)
            setAnnouncement(
                `${latest.current.label(id)} picked up. Use the arrow keys to move it, Space to drop, Escape to cancel.`
            );
    };

    const handleProps: DragState['handleProps'] = (id) => ({
        onPointerDown: (event) => {
            if (event.button !== 0 || session.current) return;
            const element = event.currentTarget;
            if (event.pointerType === 'touch') {
                const x = event.clientX;
                const y = event.clientY;
                touch.current = {
                    id,
                    x,
                    y,
                    timer: window.setTimeout(() => {
                        touch.current = null;
                        element.setPointerCapture(event.pointerId);
                        begin(id, false);
                        setPointer({ x, y });
                    }, TOUCH_HOLD_MS),
                };
                return;
            }
            event.preventDefault();
            element.setPointerCapture(event.pointerId);
            begin(id, false);
            setPointer({ x: event.clientX, y: event.clientY });
        },
        onPointerMove: (event) => {
            const waiting = touch.current;
            if (waiting && Math.hypot(event.clientX - waiting.x, event.clientY - waiting.y) > TOUCH_SLOP) {
                window.clearTimeout(waiting.timer);
                touch.current = null;
            }
            const current = session.current;
            if (!current || current.keyboard) return;
            event.preventDefault();
            setPointer({ x: event.clientX, y: event.clientY });
            const from = current.origin.indexOf(current.id);
            const to = indexForPointer(current.centers, event.clientY);
            setPreview(move(current.origin, from, to));
            if (event.clientY < EDGE) window.scrollBy(0, -14);
            else if (event.clientY > window.innerHeight - EDGE) window.scrollBy(0, 14);
        },
        onPointerUp: () => {
            if (touch.current) {
                window.clearTimeout(touch.current.timer);
                touch.current = null;
            }
            if (session.current && !session.current.keyboard) finish(true);
        },
        onPointerCancel: () => {
            if (touch.current) {
                window.clearTimeout(touch.current.timer);
                touch.current = null;
            }
            if (session.current && !session.current.keyboard) finish(false);
        },
        onKeyDown: (event) => {
            const current = session.current;
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                if (current?.keyboard && current.id === id) finish(true);
                else if (!current) begin(id, true);
                return;
            }
            if (!current?.keyboard || current.id !== id) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                setPreview((shown) => {
                    const list = shown ?? current.origin;
                    const index = list.indexOf(id);
                    const next = move(list, index, index + (event.key === 'ArrowUp' ? -1 : 1));
                    setAnnouncement(`${latest.current.label(id)}, position ${next.indexOf(id) + 1} of ${next.length}.`);
                    return next;
                });
            }
        },
        onBlur: () => {
            // Losing focus mid keyboard move drops the change instead of leaving a half finished state.
            if (session.current?.keyboard) finish(false);
        },
    });

    useEffect(
        () => () => {
            if (touch.current) window.clearTimeout(touch.current.timer);
        },
        []
    );

    return { order, draggingId, pointer, announcement, rowRef, handleProps };
}
