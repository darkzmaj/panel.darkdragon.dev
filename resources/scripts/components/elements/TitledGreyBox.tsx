import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isString } from '@/lib/objects';

interface Props {
    icon?: LucideIcon;
    title: string | React.ReactNode;
    className?: string;
    contentClassName?: string;
    children: React.ReactNode;
}

/** A card with a header row (icon and title) and a body. */
const TitledGreyBox = ({ icon: Icon, title, children, className, contentClassName }: Props) => (
    <div className={cn('gb-card', className)} style={{ padding: 0 }}>
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 18px',
                borderBottom: '1px solid var(--gb-border-muted)',
            }}
        >
            {isString(title) ? (
                <>
                    {Icon && <Icon aria-hidden width={16} height={16} style={{ color: 'var(--gb-text-2)' }} />}
                    <span className={'gb-eyebrow'}>{title}</span>
                </>
            ) : (
                title
            )}
        </div>
        <div className={contentClassName} style={{ padding: 18 }}>
            {children}
        </div>
    </div>
);

export default TitledGreyBox;
