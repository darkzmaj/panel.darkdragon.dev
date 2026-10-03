import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react';
import isEqual from 'react-fast-compare';

interface Props {
    icon?: LucideIcon;
    title: string | React.ReactNode;
    className?: string;
    children: React.ReactNode;
}

// A card with a header row (icon + title) and a body.
const TitledGreyBox = ({ icon: Icon, title, children, className }: Props) => (
    <div className={'gb-card ' + (className || '')} style={{ padding: 0 }}>
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 18px',
                borderBottom: '1px solid var(--gb-border-muted)',
            }}
        >
            {typeof title === 'string' ? (
                <>
                    {Icon && <Icon aria-hidden width={16} height={16} style={{ color: 'var(--gb-text-2)' }} />}
                    <span className={'gb-eyebrow'}>{title}</span>
                </>
            ) : (
                title
            )}
        </div>
        <div style={{ padding: 18 }}>{children}</div>
    </div>
);

export default memo(TitledGreyBox, isEqual);
