import React from 'react';

// Placeholder blocks shown while data loads. Sized like the content so nothing jumps when it arrives.
export const Skeleton = ({ className = '' }: { className?: string }) => (
    <div aria-hidden className={`animate-pulse rounded bg-neutral-600 ${className}`} />
);

export const SkeletonRows = ({ count = 4, className = 'h-20' }: { count?: number; className?: string }) => (
    <div role={'status'} aria-label={'Loading'}>
        {Array.from({ length: count }).map((_, i) => (
            <Skeleton key={i} className={`${className} ${i > 0 ? 'mt-2' : ''}`} />
        ))}
    </div>
);
