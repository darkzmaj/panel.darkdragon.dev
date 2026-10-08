import React from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';

export const NavLabel = ({ children }: { children: React.ReactNode }) => (
    <div className={'gb-nav-label'}>{children}</div>
);

interface ItemProps extends Omit<React.ComponentProps<'a'>, 'href'> {
    to: string;
    icon?: LucideIcon;
    exact?: boolean;
    params?: Record<string, string>;
    hash?: string;
    /** Other address prefixes that keep this entry highlighted (pages merged into one workspace). */
    alsoActive?: string[];
}

/** A sidebar link: icon, label and the blue active state of the Gobia design. */
export function NavItem({ to, icon: Icon, exact = false, params, alsoActive, children, ...rest }: ItemProps) {
    const path = useLocation({ select: (location) => location.pathname });
    const also = alsoActive?.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? false;

    return (
        <Link
            to={to as never}
            params={params as never}
            activeOptions={{ exact, includeSearch: false }}
            activeProps={{ className: 'gb-nav-item active' }}
            className={'gb-nav-item' + (also ? ' active' : '')}
            aria-current={also ? 'page' : undefined}
            {...rest}
        >
            {Icon && <Icon aria-hidden />}
            <span>{children}</span>
        </Link>
    );
}
