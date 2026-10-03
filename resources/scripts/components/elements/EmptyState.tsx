import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
    icon: LucideIcon;
    title: string;
    children?: React.ReactNode;
}

// What a list shows when it has nothing to list: a short title and one line saying why or what to do next.
const EmptyState = ({ icon: Icon, title, children }: Props) => (
    <div className={'gb-emptystate'}>
        <span aria-hidden>
            <Icon />
        </span>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
    </div>
);

export default EmptyState;
