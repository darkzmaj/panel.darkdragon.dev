import React from 'react';

interface Props {
    title: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}

/** The header every page starts with: title, one line of context and the page's actions. */
export default function PageHeading({ title, description, actions, className }: Props) {
    return (
        <header className={'gb-page-head' + (className ? ` ${className}` : '')}>
            <div style={{ minWidth: 0 }}>
                <h1>{title}</h1>
                {description && <p>{description}</p>}
            </div>
            {actions && <div className={'gb-page-actions'}>{actions}</div>}
        </header>
    );
}
