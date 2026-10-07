import React, { use } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ContextMenu } from '@base-ui/react/context-menu';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import Icon from '@/components/elements/Icon';

const positionerClass = 'z-[9999] outline-hidden';

const popupClass =
    'min-w-52 bg-card border border-border/55 rounded-md shadow-[var(--gb-shadow-pop)] p-1.5 text-sm text-foreground ' +
    'outline-hidden origin-[var(--transform-origin)] transition duration-100 ' +
    'data-[starting-style]:opacity-0 data-[starting-style]:scale-95 ' +
    'data-[ending-style]:opacity-0 data-[ending-style]:scale-95';

type MenuItemComponent = React.ComponentType<React.ComponentProps<typeof Menu.Item>>;
const MenuItemContext = React.createContext<MenuItemComponent>(Menu.Item as MenuItemComponent);
const ContextMenuItem = (props: React.ComponentProps<typeof Menu.Item>) => <ContextMenu.Item {...props} />;

interface DropdownMenuProps {
    /** Rendered inside the trigger `<button>`. */
    triggerContent: React.ReactNode;
    triggerClassName?: string;
    children: React.ReactNode;
    className?: string;
}

function DropdownMenu({ triggerContent, triggerClassName, children, className }: DropdownMenuProps) {
    return (
        <Menu.Root>
            <Menu.Trigger className={triggerClassName}>{triggerContent}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Positioner className={positionerClass} sideOffset={4} align={'end'}>
                    <Menu.Popup className={cn(popupClass, className)}>
                        <MenuItemContext.Provider value={Menu.Item as MenuItemComponent}>
                            {children}
                        </MenuItemContext.Provider>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

interface ContextDropdownMenuProps {
    className?: string;
    menuClassName?: string;
    children: React.ReactNode;
    items: React.ReactNode;
}

/** Opens `items` at the cursor on right-click or long-press over `children`. */
export function ContextDropdownMenu({ className, menuClassName, children, items }: ContextDropdownMenuProps) {
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger className={className}>{children}</ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className={positionerClass}>
                    <ContextMenu.Popup className={cn(popupClass, menuClassName)}>
                        <MenuItemContext.Provider value={ContextMenuItem}>{items}</MenuItemContext.Provider>
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
    );
}

interface ItemProps extends React.ComponentProps<typeof Menu.Item> {
    icon?: LucideIcon;
    danger?: boolean;
    description?: React.ReactNode;
}

/** An item for either DropdownMenu or ContextDropdownMenu. */
export function DropdownMenuItem({ icon, danger, description, className, children, ...props }: ItemProps) {
    const Item = use(MenuItemContext);

    return (
        <Item
            className={cn(
                'group flex w-full gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer select-none outline-hidden',
                description ? 'items-start' : 'items-center',
                'text-foreground transition-colors duration-100 data-[highlighted]:bg-secondary data-[highlighted]:text-foreground',
                danger && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
                className
            )}
            {...props}
        >
            {icon && (
                <span
                    className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors',
                        description && 'mt-0.5',
                        danger && 'text-destructive'
                    )}
                >
                    <Icon icon={icon} className={'h-4 w-4'} />
                </span>
            )}
            <span className={'flex min-w-0 flex-1 flex-col'}>
                <span className={'truncate text-sm leading-5'}>{children}</span>
                {description && (
                    <span
                        className={cn(
                            'mt-0.5 text-xs leading-4 text-muted-foreground',
                            'group-data-[highlighted]:text-muted-foreground',
                            danger && 'group-data-[highlighted]:text-destructive/80'
                        )}
                    >
                        {description}
                    </span>
                )}
            </span>
        </Item>
    );
}

// Assigned as a static property; Object.assign would hide the component from Fast Refresh.
const DropdownMenuWithItems = DropdownMenu as typeof DropdownMenu & { Item: typeof DropdownMenuItem };
DropdownMenuWithItems.Item = DropdownMenuItem;

export default DropdownMenuWithItems;
