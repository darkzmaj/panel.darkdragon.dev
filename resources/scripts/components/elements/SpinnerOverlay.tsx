import React from 'react';
import Spinner, { SpinnerSize } from '@/components/elements/Spinner';
import Fade from '@/components/elements/Fade';
import tw from 'twin.macro';

interface Props {
    visible: boolean;
    fixed?: boolean;
    size?: SpinnerSize;
    backgroundOpacity?: number;
}

const SpinnerOverlay: React.FC<Props> = ({ size, fixed, visible, backgroundOpacity, children }) => (
    <Fade timeout={150} in={visible} unmountOnExit>
        <div
            css={[
                tw`top-0 left-0 flex items-center justify-center w-full h-full rounded flex-col z-40`,
                !fixed ? tw`absolute` : tw`fixed`,
            ]}
            style={{ background: `rgb(var(--n-900) / ${backgroundOpacity || 0.55})` }}
        >
            <Spinner size={size} />
            {children && (typeof children === 'string' ? <p css={tw`mt-4 text-neutral-400`}>{children}</p> : children)}
        </div>
    </Fade>
);

export default SpinnerOverlay;
