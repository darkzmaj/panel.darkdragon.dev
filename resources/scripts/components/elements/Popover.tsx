import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
    // The element the popover is attached to (usually the toggle button).
    anchor: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    align?: 'start' | 'end';
    role?: 'menu' | 'listbox';
    label?: string;
    className?: string;
    children: React.ReactNode;
}

const ITEMS = '[role="menuitem"],[role="menuitemradio"],[role="option"]';
const GAP = 4;
const MARGIN = 8;

// The one popover/menu primitive. It renders into document.body so no ancestor can clip or stack over it, positions
// itself next to the anchor inside the viewport (flipping above when there is no room below), closes on outside
// click, Escape and Tab, supports arrow-key navigation and gives focus back to the anchor when it closes.
const Popover = ({ anchor, open, onClose, align = 'start', role = 'menu', label, className, children }: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

    const place = useCallback(() => {
        const menu = ref.current;
        if (!anchor || !menu) return;

        const a = anchor.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        let left = align === 'end' ? a.right - width : a.left;
        left = Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN));
        const below = a.bottom + GAP;
        const top =
            below + height > window.innerHeight - MARGIN && a.top - GAP - height > MARGIN
                ? a.top - GAP - height
                : below;

        setStyle({ position: 'fixed', left, top, maxHeight: window.innerHeight - MARGIN * 2, overflowY: 'auto' });
    }, [anchor, align]);

    useLayoutEffect(() => {
        if (open) place();
    }, [open, place, children]);

    useEffect(() => {
        if (!open) return;

        const close = (refocus: boolean) => {
            onClose();
            if (refocus) anchor?.focus();
        };
        const onPointer = (e: MouseEvent) => {
            const target = e.target as Node;
            if (!ref.current?.contains(target) && !anchor?.contains(target)) close(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
            } else if (e.key === 'Tab') {
                close(false);
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) || []);
                if (!items.length) return;
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next =
                    e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                        ? items.length - 1
                        : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next].focus();
            }
        };
        const reposition = () => place();

        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        ref.current?.querySelector<HTMLElement>(ITEMS)?.focus();

        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }, [open, anchor, onClose, place]);

    // Reset so the next opening measures from scratch instead of flashing at the previous position.
    useEffect(() => {
        if (!open) setStyle({ visibility: 'hidden' });
    }, [open]);

    if (!open) return null;

    return createPortal(
        <div ref={ref} role={role} aria-label={label} style={{ zIndex: 60, ...style }} className={className}>
            {children}
        </div>,
        document.body
    );
};

export default Popover;
