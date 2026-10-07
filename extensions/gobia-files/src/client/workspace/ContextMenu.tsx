import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
    key: string;
    label: string;
    icon: LucideIcon;
    danger?: boolean;
    onSelect: () => void;
}

export interface MenuState {
    x: number;
    y: number;
    label: string;
    items: MenuItem[];
}

/** A small floating menu at a screen position (right click, menu key or the row's three dots). */
export default function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
    const root = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

    useLayoutEffect(() => {
        if (!menu || !root.current) {
            setPosition(null);
            return;
        }
        const box = root.current.getBoundingClientRect();
        setPosition({
            left: Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8)),
        });
    }, [menu]);

    useEffect(() => {
        if (!menu) return;
        const away = (event: Event) => {
            if (!root.current?.contains(event.target as Node)) onClose();
        };
        const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', key);
        window.addEventListener('blur', onClose);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('mousedown', away);
            document.removeEventListener('keydown', key);
            window.removeEventListener('blur', onClose);
            window.removeEventListener('resize', onClose);
        };
    }, [menu, onClose]);

    useEffect(() => {
        if (position) root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    }, [position]);

    if (!menu) return null;

    return (
        <div
            ref={root}
            role={'menu'}
            aria-label={menu.label}
            className={'gb-menu'}
            style={{
                position: 'fixed',
                zIndex: 90,
                left: position?.left ?? menu.x,
                top: position?.top ?? menu.y,
                visibility: position ? 'visible' : 'hidden',
            }}
            onKeyDown={(event) => {
                const items = [...(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
                const index = items.indexOf(document.activeElement as HTMLElement);
                if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
                if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') event.preventDefault();
            }}
        >
            {menu.items.map(({ key, label, icon: Icon, danger, onSelect }) => (
                <button
                    key={key}
                    type={'button'}
                    role={'menuitem'}
                    className={'gb-menu-item' + (danger ? ' danger' : '')}
                    onClick={() => {
                        onClose();
                        onSelect();
                    }}
                >
                    <Icon aria-hidden /> {label}
                </button>
            ))}
        </div>
    );
}
