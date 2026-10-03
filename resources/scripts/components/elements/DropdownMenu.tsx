import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import styled from 'styled-components/macro';
import tw from 'twin.macro';
import Popover from '@/components/elements/Popover';

interface Props {
    children: React.ReactNode;
    renderToggle: (onClick: (e: React.MouseEvent<any, MouseEvent>) => void) => React.ReactChild;
}

export const DropdownButtonRow = styled.button.attrs({ role: 'menuitem' })<{ danger?: boolean }>`
    ${tw`p-2 flex items-center rounded w-full text-neutral-500`};
    transition: 150ms all ease;

    &:hover,
    &:focus {
        ${(props) => (props.danger ? tw`text-red-700 bg-red-100` : tw`text-neutral-700 bg-neutral-100`)};
        outline: none;
    }
`;

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
            <Popover
                anchor={anchor}
                open={open}
                onClose={close}
                align={'end'}
                className={'w-48 bg-white p-2 rounded border border-neutral-700 shadow-lg text-neutral-500'}
            >
                <div onClick={close}>{children}</div>
            </Popover>
        </div>
    );
});

DropdownMenu.displayName = 'DropdownMenu';

export default DropdownMenu;
