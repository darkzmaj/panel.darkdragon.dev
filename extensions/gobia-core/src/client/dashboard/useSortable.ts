import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

// Touch timing. Holding still for HOLD_ARM shows that the row is "taken", HOLD_LIFT lifts it so it can be dragged and
// holding still past HOLD_MENU opens the action menu instead. Moving before HOLD_LIFT is a scroll and cancels everything.
const HOLD_ARM = 500;
const HOLD_LIFT = 1200;
const HOLD_MENU = 2300;
const SLOP = 8;
const EDGE = 90;

type Phase = 'idle' | 'lifted' | 'dragging';

interface Session {
    id: string;
    index: number;
    pointerId: number;
    touch: boolean;
    x: number;
    y: number;
    phase: Phase;
    tops: number[];
    heights: number[];
    timers: Array<ReturnType<typeof setTimeout>>;
    target: number;
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    if (from === to || to < 0 || to >= list.length) return [...list];
    const copy = [...list];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item as T);
    return copy;
}

const buzz = (ms: number) => {
    try {
        navigator.vibrate?.(ms);
    } catch {
        // Haptics are a bonus, never required.
    }
};

interface Options {
    ids: readonly string[];
    onReorder: (ids: string[]) => void;
    /** Touch: the row was held still, so the user wants its actions. Mouse right clicks are handled by the caller. */
    onMenu?: (id: string, x: number, y: number) => void;
}

/**
 * Pointer events based reordering of a list of rows. Desktop: drag a row or its grip, the grip also takes the arrow
 * keys. Touch: press and hold, then drag; keep holding without moving for the actions. While a row is dragged only CSS
 * transforms change, so React renders nothing per move and the other rows slide out of the way.
 */
export function useSortable({ ids, onReorder, onMenu }: Options) {
    const list = useRef<HTMLUListElement>(null);
    const items = useRef(new Map<string, HTMLLIElement>());
    const session = useRef<Session | null>(null);
    const justDragged = useRef(false);
    const latest = useRef({ ids, onReorder, onMenu });
    useEffect(() => {
        latest.current = { ids, onReorder, onMenu };
    });

    const clearStyles = () => {
        items.current.forEach((element) => {
            element.style.transform = '';
            element.style.transition = '';
            element.style.zIndex = '';
            element.classList.remove('arming', 'lifted', 'dragging');
        });
        list.current?.classList.remove('gb-reordering');
    };

    const handlers = useRef<{
        move: (event: globalThis.PointerEvent) => void;
        up: (event: globalThis.PointerEvent) => void;
        cancel: (event: globalThis.PointerEvent) => void;
        touch: (event: TouchEvent) => void;
    } | null>(null);
    const stable = useRef({
        move: (event: globalThis.PointerEvent) => handlers.current?.move(event),
        up: (event: globalThis.PointerEvent) => handlers.current?.up(event),
        cancel: (event: globalThis.PointerEvent) => handlers.current?.cancel(event),
        touch: (event: TouchEvent) => handlers.current?.touch(event),
    }).current;

    const finish = (commit: boolean) => {
        const current = session.current;
        if (!current) return;
        current.timers.forEach(clearTimeout);
        window.removeEventListener('pointermove', stable.move);
        window.removeEventListener('pointerup', stable.up);
        window.removeEventListener('pointercancel', stable.cancel);
        window.removeEventListener('touchmove', stable.touch);
        session.current = null;
        const dragged = current.phase === 'dragging';
        clearStyles();
        if (dragged) {
            justDragged.current = true;
            setTimeout(() => (justDragged.current = false), 0);
            if (commit && current.target !== current.index) {
                latest.current.onReorder(moveItem(latest.current.ids, current.index, current.target));
            }
        }
    };

    const layout = (current: Session) => {
        current.tops = [];
        current.heights = [];
        latest.current.ids.forEach((id) => {
            const rect = items.current.get(id)?.getBoundingClientRect();
            current.tops.push(rect ? rect.top : 0);
            current.heights.push(rect ? rect.height : 0);
        });
    };

    const place = (y: number) => {
        const current = session.current;
        if (!current) return;
        const dy = y - current.y;
        const dragged = items.current.get(current.id);
        if (!dragged) return;
        dragged.style.transform = `translateY(${dy}px) scale(1.01)`;

        // Where the dragged row's centre sits among the original row centres decides its new position.
        const centre = (current.tops[current.index] ?? 0) + (current.heights[current.index] ?? 0) / 2 + dy;
        let target = current.index;
        current.tops.forEach((top, index) => {
            const middle = top + (current.heights[index] ?? 0) / 2;
            if (index < current.index && centre < middle) target = Math.min(target, index);
            if (index > current.index && centre > middle) target = Math.max(target, index);
        });
        current.target = target;

        const height = current.heights[current.index] ?? 0;
        latest.current.ids.forEach((id, index) => {
            if (index === current.index) return;
            const element = items.current.get(id);
            if (!element) return;
            const shift =
                current.index < target && index > current.index && index <= target
                    ? -height
                    : current.index > target && index < current.index && index >= target
                      ? height
                      : 0;
            element.style.transition = 'transform 120ms var(--gb-ease)';
            element.style.transform = shift ? `translateY(${shift}px)` : '';
        });

        // Near the top or bottom edge, scroll the page so a long list can be dragged all the way.
        if (y < EDGE) window.scrollBy(0, -14);
        else if (y > window.innerHeight - EDGE) window.scrollBy(0, 14);
    };

    const startDrag = () => {
        const current = session.current;
        if (!current) return;
        current.timers.forEach(clearTimeout);
        current.phase = 'dragging';
        layout(current);
        const element = items.current.get(current.id);
        if (element) {
            element.classList.add('dragging');
            element.style.zIndex = '5';
            element.style.transition = 'none';
        }
        list.current?.classList.add('gb-reordering');
    };

    handlers.current = {
        move: (event) => {
            const current = session.current;
            if (!current || event.pointerId !== current.pointerId) return;
            const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
            if (current.phase === 'idle') {
                if (distance <= SLOP) return;
                // A finger that moves before the row is lifted is scrolling the page. A mouse that moves is dragging.
                if (current.touch) return finish(false);
                startDrag();
            } else if (current.phase === 'lifted' && distance > SLOP) {
                startDrag();
                buzz(6);
            }
            if (session.current?.phase === 'dragging') place(event.clientY);
        },
        up: (event) => {
            if (session.current && event.pointerId === session.current.pointerId) finish(true);
        },
        cancel: (event) => {
            if (session.current && event.pointerId === session.current.pointerId) finish(false);
        },
        touch: (event) => {
            if (session.current && session.current.phase !== 'idle' && event.cancelable) event.preventDefault();
        },
    };

    useEffect(() => () => finish(false), []);

    const begin = (event: PointerEvent, id: string, index: number, fromGrip: boolean) => {
        if (session.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const origin = event.target as HTMLElement;
        // Buttons other than the grip (the menu button) never start a drag.
        if (!fromGrip && origin.closest('button')) return;

        const touch = event.pointerType !== 'mouse';
        const current: Session = {
            id,
            index,
            pointerId: event.pointerId,
            touch,
            x: event.clientX,
            y: event.clientY,
            phase: 'idle',
            tops: [],
            heights: [],
            timers: [],
            target: index,
        };
        session.current = current;
        window.addEventListener('pointermove', stable.move);
        window.addEventListener('pointerup', stable.up);
        window.addEventListener('pointercancel', stable.cancel);

        if (touch) {
            const element = items.current.get(id);
            window.addEventListener('touchmove', stable.touch, { passive: false });
            current.timers.push(
                setTimeout(() => {
                    element?.classList.add('arming');
                    buzz(8);
                }, HOLD_ARM),
                setTimeout(() => {
                    if (!session.current) return;
                    session.current.phase = 'lifted';
                    element?.classList.remove('arming');
                    element?.classList.add('lifted');
                    buzz(16);
                }, HOLD_LIFT),
                setTimeout(() => {
                    // Still held without moving: this was a request for the actions, not a drag.
                    const held = session.current;
                    if (!held || held.phase !== 'lifted') return;
                    const { x, y } = held;
                    finish(false);
                    buzz(24);
                    latest.current.onMenu?.(id, x, y);
                }, HOLD_MENU)
            );
        }
    };

    const register = useCallback(
        (id: string) => (element: HTMLLIElement | null) => {
            if (element) items.current.set(id, element);
            else items.current.delete(id);
        },
        []
    );

    return {
        list,
        register,
        /** Props for the row element (`li`). */
        rowProps: (id: string, index: number) => ({
            onPointerDown: (event: PointerEvent) => begin(event, id, index, false),
            onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
                if (justDragged.current) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            },
            onDragStart: (event: { preventDefault: () => void }) => event.preventDefault(),
        }),
        /** Props for the grip button: a drag handle that also takes the arrow keys. */
        gripProps: (id: string, index: number) => ({
            onPointerDown: (event: PointerEvent) => {
                event.stopPropagation();
                begin(event, id, index, true);
            },
            onKeyDown: (event: KeyboardEvent) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                const next = moveItem(latest.current.ids, index, index + (event.key === 'ArrowUp' ? -1 : 1));
                latest.current.onReorder(next);
            },
        }),
    };
}
