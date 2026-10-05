import React, { memo, useEffect, useRef } from 'react';
import { Ellipsis, GripVertical } from 'lucide-react';
import { Server } from '@/api/server/getServer';
import ServerRow from '@/components/dashboard/ServerRow';

interface Props {
    servers: Server[];
    colors?: Record<string, string | null>;
    onReorder: (servers: Server[]) => void;
    onMenu?: (server: Server, x: number, y: number) => void;
}

const move = (list: Server[], from: number, to: number) => {
    if (from === to || to < 0 || to >= list.length) return list;
    const copy = [...list];
    copy.splice(to, 0, copy.splice(from, 1)[0]);

    return copy;
};

// Touch timing. Holding still for HOLD_ARM shows that the row is "taken", HOLD_LIFT lifts it so it can be dragged, and
// holding still past HOLD_MENU instead opens the action menu. Moving before HOLD_LIFT is a scroll and cancels everything.
const HOLD_ARM = 500;
const HOLD_LIFT = 1200;
const HOLD_MENU = 2300;
const SLOP = 8;

type Phase = 'idle' | 'lifted' | 'dragging';

interface Session {
    uuid: string;
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

const buzz = (ms: number) => {
    try {
        navigator.vibrate?.(ms);
    } catch {
        // Haptics are a bonus, never required.
    }
};

// Instance rows that can be rearranged. Desktop: drag a row (or its grip) with the mouse; the grip also takes the
// arrow keys. Touch: press and hold a row, then drag; keep holding without moving to open its actions. Everything runs
// on pointer events, and while a row is being dragged only CSS transforms change, so nothing re-renders per move.
const SortableServerList = ({ servers, colors, onReorder, onMenu }: Props) => {
    const list = useRef<HTMLUListElement>(null);
    const items = useRef(new Map<string, HTMLLIElement>());
    const session = useRef<Session | null>(null);
    const lastType = useRef<string>('mouse');
    const justDragged = useRef(false);
    const latest = useRef({ servers, onReorder, onMenu });
    latest.current = { servers, onReorder, onMenu };

    const clearStyles = () => {
        items.current.forEach((el) => {
            el.style.transform = '';
            el.style.transition = '';
            el.style.zIndex = '';
            el.classList.remove('arming', 'lifted', 'dragging');
        });
        list.current?.classList.remove('gb-reordering');
    };

    // Window listeners need stable identities so they can be removed again; they forward to the latest handlers.
    const handlers = useRef<{
        move: (e: PointerEvent) => void;
        up: (e: PointerEvent) => void;
        cancel: (e: PointerEvent) => void;
        touch: (e: TouchEvent) => void;
    }>();
    const stable = useRef({
        move: (e: PointerEvent) => handlers.current?.move(e),
        up: (e: PointerEvent) => handlers.current?.up(e),
        cancel: (e: PointerEvent) => handlers.current?.cancel(e),
        touch: (e: TouchEvent) => handlers.current?.touch(e),
    }).current;

    const finish = (commit: boolean) => {
        const s = session.current;
        if (!s) return;
        s.timers.forEach(clearTimeout);
        window.removeEventListener('pointermove', stable.move);
        window.removeEventListener('pointerup', stable.up);
        window.removeEventListener('pointercancel', stable.cancel);
        window.removeEventListener('touchmove', stable.touch);
        session.current = null;
        const dragged = s.phase === 'dragging';
        clearStyles();
        if (dragged) {
            justDragged.current = true;
            setTimeout(() => (justDragged.current = false), 0);
            if (commit && s.target !== s.index) {
                latest.current.onReorder(move(latest.current.servers, s.index, s.target));
            }
        }
    };

    const blockScroll = (e: TouchEvent) => {
        if (session.current && session.current.phase !== 'idle' && e.cancelable) e.preventDefault();
    };

    const layout = (s: Session) => {
        const order = latest.current.servers;
        s.tops = [];
        s.heights = [];
        order.forEach((server) => {
            const rect = items.current.get(server.uuid)?.getBoundingClientRect();
            s.tops.push(rect ? rect.top : 0);
            s.heights.push(rect ? rect.height : 0);
        });
    };

    const place = (y: number) => {
        const s = session.current;
        if (!s) return;
        const dy = y - s.y;
        const draggedEl = items.current.get(s.uuid);
        if (!draggedEl) return;
        draggedEl.style.transform = `translateY(${dy}px) scale(1.01)`;

        // Where the dragged row's centre sits among the original row centres decides its new position.
        const centre = s.tops[s.index] + s.heights[s.index] / 2 + dy;
        let target = s.index;
        s.tops.forEach((top, i) => {
            const mid = top + s.heights[i] / 2;
            if (i < s.index && centre < mid) target = Math.min(target, i);
            if (i > s.index && centre > mid) target = Math.max(target, i);
        });
        s.target = target;

        latest.current.servers.forEach((server, i) => {
            if (i === s.index) return;
            const el = items.current.get(server.uuid);
            if (!el) return;
            const shift =
                s.index < target && i > s.index && i <= target
                    ? -s.heights[s.index]
                    : s.index > target && i < s.index && i >= target
                    ? s.heights[s.index]
                    : 0;
            el.style.transition = 'transform 120ms var(--gb-ease)';
            el.style.transform = shift ? `translateY(${shift}px)` : '';
        });

        // Near the top or bottom edge, scroll the page so a long list can be dragged all the way.
        if (y < 90) window.scrollBy(0, -14);
        else if (y > window.innerHeight - 90) window.scrollBy(0, 14);
    };

    const startDrag = () => {
        const s = session.current;
        if (!s) return;
        s.timers.forEach(clearTimeout);
        s.phase = 'dragging';
        layout(s);
        const el = items.current.get(s.uuid);
        if (el) {
            el.classList.add('dragging');
            el.style.zIndex = '5';
            el.style.transition = 'none';
        }
        list.current?.classList.add('gb-reordering');
    };

    const onMove = (e: PointerEvent) => {
        const s = session.current;
        if (!s || e.pointerId !== s.pointerId) return;
        const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);

        if (s.phase === 'idle') {
            if (dist <= SLOP) return;
            // A finger that moves before the row is lifted is scrolling the page. A mouse that moves is dragging.
            if (s.touch) return finish(false);
            startDrag();
        } else if (s.phase === 'lifted' && dist > SLOP) {
            startDrag();
            buzz(6);
        }
        if (session.current?.phase === 'dragging') place(e.clientY);
    };

    const onUp = (e: PointerEvent) => {
        if (session.current && e.pointerId === session.current.pointerId) finish(true);
    };

    const onCancel = (e: PointerEvent) => {
        if (session.current && e.pointerId === session.current.pointerId) finish(false);
    };

    handlers.current = { move: onMove, up: onUp, cancel: onCancel, touch: blockScroll };

    const begin = (e: React.PointerEvent, server: Server, index: number, fromGrip: boolean) => {
        lastType.current = e.pointerType;
        if (session.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const target = e.target as HTMLElement;
        // Buttons other than the grip (the menu button) are not drag starts.
        if (!fromGrip && target.closest('button')) return;

        const touch = e.pointerType !== 'mouse';
        const s: Session = {
            uuid: server.uuid,
            index,
            pointerId: e.pointerId,
            touch,
            x: e.clientX,
            y: e.clientY,
            phase: 'idle',
            tops: [],
            heights: [],
            timers: [],
            target: index,
        };
        session.current = s;
        window.addEventListener('pointermove', stable.move);
        window.addEventListener('pointerup', stable.up);
        window.addEventListener('pointercancel', stable.cancel);

        if (touch) {
            const el = items.current.get(server.uuid);
            window.addEventListener('touchmove', stable.touch, { passive: false });
            s.timers.push(
                setTimeout(() => {
                    el?.classList.add('arming');
                    buzz(8);
                }, HOLD_ARM),
                setTimeout(() => {
                    if (!session.current) return;
                    session.current.phase = 'lifted';
                    el?.classList.remove('arming');
                    el?.classList.add('lifted');
                    buzz(16);
                }, HOLD_LIFT),
                setTimeout(() => {
                    // Still held without moving: this was a request for the actions, not a drag.
                    const current = session.current;
                    if (!current || current.phase !== 'lifted') return;
                    const x = current.x;
                    const y = current.y;
                    finish(false);
                    buzz(24);
                    latest.current.onMenu?.(latest.current.servers[index], x, y);
                }, HOLD_MENU)
            );
        }
    };

    useEffect(() => () => finish(false), []);

    const keyMove = (e: React.KeyboardEvent, index: number) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        onReorder(move(servers, index, index + (e.key === 'ArrowUp' ? -1 : 1)));
    };

    return (
        <div className={'gb-list gb-server-list'}>
            <div className={'gb-list-head gb-server-head'} aria-hidden>
                <span>Instance</span>
                <span className={'gb-col-where'}>Node &amp; address</span>
                <span className={'gb-col-stats'}>CPU &middot; Memory &middot; Storage</span>
            </div>
            <ul ref={list} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {servers.map((server, index) => (
                    <li
                        key={server.uuid}
                        ref={(el) => {
                            if (el) items.current.set(server.uuid, el);
                            else items.current.delete(server.uuid);
                        }}
                        className={'gb-server-item'}
                        onPointerDown={(e) => begin(e, server, index, false)}
                        onClickCapture={(e) => {
                            if (justDragged.current) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                        }}
                        onDragStart={(e) => e.preventDefault()}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            // A touch long press is handled by the hold timers above, never by the browser's own menu.
                            if (lastType.current === 'mouse' && onMenu) onMenu(server, e.clientX, e.clientY);
                        }}
                    >
                        <div className={'gb-grip'}>
                            <button
                                type={'button'}
                                aria-label={`Reorder ${server.name}. Use the up and down arrow keys, or drag.`}
                                title={'Drag to reorder'}
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    begin(e, server, index, true);
                                }}
                                onKeyDown={(e) => keyMove(e, index)}
                                style={{ cursor: 'grab', touchAction: 'none' }}
                            >
                                <GripVertical aria-hidden />
                            </button>
                        </div>
                        <ServerRow server={server} color={colors?.[server.uuid]} />
                        {onMenu && (
                            <button
                                type={'button'}
                                className={'gb-icon-btn gb-icon-btn-sm gb-row-more'}
                                aria-label={`Actions for ${server.name}`}
                                aria-haspopup={'menu'}
                                onClick={(e) => {
                                    const r = e.currentTarget.getBoundingClientRect();
                                    onMenu(server, r.right, r.bottom);
                                }}
                            >
                                <Ellipsis aria-hidden />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default memo(SortableServerList);
