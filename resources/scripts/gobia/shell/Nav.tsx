import React from 'react';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';

export const NavLabel = ({ children }: { children: React.ReactNode }) => (
    <div className={'gb-nav-label'}>{children}</div>
);

interface ItemProps extends Omit<React.ComponentProps<'a'>, 'href'> {
    to: string;
    icon: LucideIcon;
    exact?: boolean;
    params?: Record<string, string>;
    hash?: string;
}

/** A sidebar link: icon, label and the blue active state of the Gobia design. */
export function NavItem({ to, icon: Icon, exact = false, params, children, ...rest }: ItemProps) {
    return (
        <Link
            to={to as never}
            params={params as never}
            activeOptions={{ exact, includeSearch: false }}
            activeProps={{ className: 'gb-nav-item active' }}
            className={'gb-nav-item'}
            {...rest}
        >
            <Icon aria-hidden />
            <span>{children}</span>
        </Link>
    );
}
