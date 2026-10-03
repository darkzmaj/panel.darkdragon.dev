import React from 'react';

// Placeholder blocks shown while data loads. Sized like the content so nothing jumps when it arrives.
export const Skeleton = ({ className = '', style }: { className?: string; style?: React.CSSProperties }) => (
    <div aria-hidden className={`gb-skeleton ${className}`} style={style} />
);

export const SkeletonRows = ({ count = 4, className = 'h-20' }: { count?: number; className?: string }) => (
    <div role={'status'} aria-label={'Loading'}>
        {Array.from({ length: count }).map((_, i) => (
            <Skeleton key={i} className={`${className} ${i > 0 ? 'mt-2' : ''}`} />
        ))}
    </div>
);
