import React, { useEffect } from 'react';
import { cn } from '@/lib/cn';

export interface PageContentBlockProps {
    title?: string;
    className?: string;
    children?: React.ReactNode;
}

/** Page wrapper. The Gobia shell supplies the width, the sidebar and the footer. */
const PageContentBlock = ({ title, className, children }: PageContentBlockProps) => {
    useEffect(() => {
        document.title = title || document.title;
    }, [title]);

    return <div className={cn('gb-page', className)}>{children}</div>;
};

export default PageContentBlock;
