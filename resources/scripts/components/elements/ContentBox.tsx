import React from 'react';
import FlashMessageRender from '@/components/FlashMessageRender';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import tw from 'twin.macro';

type Props = Readonly<
    React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
        title?: string;
        description?: string;
        borderColor?: string;
        showFlashes?: string | boolean;
        showLoadingOverlay?: boolean;
    }
>;

// The standard Gobia card: title, optional description, then the content.
const ContentBox = ({
    title,
    description,
    borderColor,
    showFlashes,
    showLoadingOverlay,
    children,
    ...props
}: Props) => (
    <div {...props}>
        <div className={'gb-card'} style={{ position: 'relative' }}>
            {(title || description) && (
                <div style={{ marginBottom: 16 }}>
                    {title && <h3 className={'gb-card-title'}>{title}</h3>}
                    {description && <p className={'gb-card-sub'}>{description}</p>}
                </div>
            )}
            {showFlashes && (
                <FlashMessageRender byKey={typeof showFlashes === 'string' ? showFlashes : undefined} css={tw`mb-4`} />
            )}
            <SpinnerOverlay visible={showLoadingOverlay || false} />
            {children}
        </div>
    </div>
);

export default ContentBox;
