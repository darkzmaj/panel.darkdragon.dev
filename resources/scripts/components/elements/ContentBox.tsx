import React from 'react';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';

type Props = Readonly<
    React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
        title?: string;
        description?: string;
        borderColor?: string;
        showLoadingOverlay?: boolean;
    }
>;

/** The standard Gobia card: title, optional description, then the content. */
const ContentBox = ({
    title,
    description,
    borderColor: _borderColor,
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
            <SpinnerOverlay visible={showLoadingOverlay || false} />
            {children}
        </div>
    </div>
);

export default ContentBox;
