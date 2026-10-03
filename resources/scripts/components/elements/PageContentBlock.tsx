import React, { useEffect } from 'react';
import FlashMessageRender from '@/components/FlashMessageRender';
import tw from 'twin.macro';

export interface PageContentBlockProps {
    title?: string;
    className?: string;
    showFlashKey?: string;
}

// The body of a page inside the application shell. The shell provides the width, padding and footer.
const PageContentBlock: React.FC<PageContentBlockProps> = ({ title, showFlashKey, className, children }) => {
    useEffect(() => {
        if (title) {
            document.title = title;
        }
    }, [title]);

    return (
        <div className={className}>
            {showFlashKey && <FlashMessageRender byKey={showFlashKey} css={tw`mb-4`} />}
            {children}
        </div>
    );
};

export default PageContentBlock;
