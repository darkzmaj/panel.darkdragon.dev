import React from 'react';

interface Props {
    title: string;
    subtitle?: string;
    // Buttons shown on the right (primary action last).
    children?: React.ReactNode;
}

// Every page starts with the same header: title, one line of context, and the page's actions.
const PageHeader = ({ title, subtitle, children }: Props) => (
    <div className={'gb-page-head'}>
        <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
        </div>
        {children && <div className={'gb-page-actions'}>{children}</div>}
    </div>
);

export default PageHeader;
