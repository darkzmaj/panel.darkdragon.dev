import React from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export const NavLabel: React.FC = ({ children }) => <div className={'gb-nav-label'}>{children}</div>;

interface ItemProps {
    to: string;
    icon: LucideIcon;
    exact?: boolean;
    onMouseEnter?: () => void;
    onFocus?: () => void;
}

/** A sidebar link: icon, label, and the blue active state from the Gobia design. */
export const NavItem: React.FC<ItemProps> = ({ to, icon: Icon, exact, children, ...handlers }) => (
    <NavLink to={to} exact={exact} className={'gb-nav-item'} activeClassName={'active'} {...handlers}>
        <Icon aria-hidden />
        <span>{children}</span>
    </NavLink>
);

/** A sidebar link that leaves the single page application (for example to the Blade admin area). */
export const NavAnchor: React.FC<{ href: string; icon: LucideIcon; target?: string }> = ({
    href,
    icon: Icon,
    target,
    children,
}) => (
    <a href={href} target={target} className={'gb-nav-item'}>
        <Icon aria-hidden />
        <span>{children}</span>
    </a>
);
