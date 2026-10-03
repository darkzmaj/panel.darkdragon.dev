import React, { Suspense } from 'react';
import ErrorBoundary from '@/components/elements/ErrorBoundary';
import { Skeleton } from '@/components/elements/Skeleton';

// Shown the instant a lazily loaded route starts loading, so navigation never looks frozen or flashes a full-page spinner.
export const RouteSkeleton = () => (
    <div role={'status'} aria-label={'Loading'}>
        <Skeleton className={'h-8 w-48 mb-6'} />
        <Skeleton className={'h-24'} />
        <Skeleton className={'h-24 mt-2'} />
        <Skeleton className={'h-24 mt-2'} />
    </div>
);

const RouteSuspense: React.FC = ({ children }) => (
    <Suspense fallback={<RouteSkeleton />}>
        <ErrorBoundary>{children}</ErrorBoundary>
    </Suspense>
);

export default RouteSuspense;
