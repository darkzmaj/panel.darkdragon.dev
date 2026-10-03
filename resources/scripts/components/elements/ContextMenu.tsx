import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import Popover from '@/components/elements/Popover';

export interface MenuItem {
    key: string;
    label: string;
    icon?: LucideIcon;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
    // Draws a divider above the item.
    separator?: boolean;
}

export interface MenuState {
    x: number;
    y: number;
    items: MenuItem[];
    title?: string;
}

const SHEET_BREAKPOINT = 640;

// Right click and three-dot menus share this one implementation: a popover placed at a point (the pointer, or the
// corner of a button) that flips to stay on screen, with arrow-key navigation, Escape to close and focus return. On
// narrow screens the same items appear as a bottom sheet, which is reachable with a thumb and never clipped.
export default ({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) => {
    const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
    const sheet = useRef<HTMLDivElement>(null);
    const isSheet = typeof window !== 'undefined' && window.innerWidth < SHEET_BREAKPOINT;

    useEffect(() => {
        if (!menu || !isSheet) return undefined;
        const first = sheet.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
        first?.focus();

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);

        return () => document.removeEventListener('keydown', onKey);
    }, [menu, isSheet]);

    if (!menu) return null;

    const rows = (
        <>
            {menu.items.map((item) => (
                <React.Fragment key={item.key}>
                    {item.separator && <div className={'gb-menu-sep'} role={'separator'} />}
                    <button
                        type={'button'}
                        role={'menuitem'}
                        disabled={item.disabled}
                        className={'gb-menu-item' + (item.danger ? ' danger' : '')}
                        onClick={() => {
                            onClose();
                            item.onSelect();
                        }}
                    >
                        {item.icon && <item.icon aria-hidden />}
                        <span>{item.label}</span>
                    </button>
                </React.Fragment>
            ))}
        </>
    );

    if (isSheet) {
        return createPortal(
            <div className={'gb-sheet-mask'} onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
                <div
                    ref={sheet}
                    role={'menu'}
                    aria-label={menu.title || 'Actions'}
                    className={'gb-sheet'}
                    onClick={(e) => e.stopPropagation()}
                >
                    {menu.title && <p className={'gb-sheet-title'}>{menu.title}</p>}
                    {rows}
                </div>
            </div>,
            document.body
        );
    }

    return (
        <>
            {createPortal(
                <span
                    ref={setAnchor}
                    aria-hidden
                    style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }}
                />,
                document.body
            )}
            <Popover
                anchor={anchor}
                open={!!anchor}
                onClose={onClose}
                label={menu.title || 'Actions'}
                className={'gb-menu'}
            >
                {rows}
            </Popover>
        </>
    );
};
