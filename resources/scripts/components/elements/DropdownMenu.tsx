import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import Popover from '@/components/elements/Popover';

interface Props {
    children: React.ReactNode;
    renderToggle: (onClick: (e: React.MouseEvent<any, MouseEvent>) => void) => React.ReactChild;
}

// A menu entry; the look comes from the shared .gb-menu-item style so every menu in the Panel matches.
export const DropdownButtonRow = ({
    danger,
    className,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) => (
    <button
        type={'button'}
        role={'menuitem'}
        className={'gb-menu-item' + (danger ? ' danger' : '') + (className ? ' ' + className : '')}
        {...props}
    />
);

export interface DropdownMenuHandle {
    // Opens (or closes) the menu next to its toggle, for example from a right click on the row.
    triggerMenu: (clientX?: number) => void;
}

// Context menu used by file rows and backups. Rendering and behavior live in the shared Popover.
const DropdownMenu = forwardRef<DropdownMenuHandle, Props>(({ children, renderToggle }, ref) => {
    const wrapper = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    useImperativeHandle(ref, () => ({
        triggerMenu: () => {
            setAnchor(wrapper.current);
            setOpen((v) => !v);
        },
    }));

    return (
        <div ref={wrapper}>
            {renderToggle((e) => {
                e.preventDefault();
                setAnchor(e.currentTarget as HTMLElement);
                setOpen((v) => !v);
            })}
            <Popover anchor={anchor} open={open} onClose={close} align={'end'} className={'gb-menu'}>
                <div onClick={close}>{children}</div>
            </Popover>
        </div>
    );
});

DropdownMenu.displayName = 'DropdownMenu';

export default DropdownMenu;
