import React from 'react';
import { cn } from '@/lib/cn';

type Props<E extends React.ElementType = 'label'> = {
    as?: E;
    isLight?: boolean;
} & Omit<React.ComponentPropsWithoutRef<E>, 'as' | 'isLight'>;

const Label = <E extends React.ElementType = 'label'>({ as, isLight: _isLight, className, ...props }: Props<E>) => {
    const Component = (as || 'label') as React.ElementType;

    return <Component className={cn('block text-sm font-semibold text-foreground mb-1.5', className)} {...props} />;
};

export default Label;
