import React, { forwardRef } from 'react';
import { Form } from 'formik';
import FlashMessageRender from '@/components/FlashMessageRender';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';
import GobiaFooter from '@/components/elements/GobiaFooter';

type Props = React.DetailedHTMLProps<React.FormHTMLAttributes<HTMLFormElement>, HTMLFormElement> & {
    title?: string;
};

// The sign-in card: centred logo, one narrow card, then the Gobia footer.
export default forwardRef<HTMLFormElement, Props>(({ title, ...props }, ref) => {
    const logo = useStoreState((state) => state.settings.data?.logo);
    const name = useStoreState((state) => state.settings.data?.name) || 'Gobia Cloud';

    return (
        <div className={'gb-auth'}>
            <div className={'gb-auth-main'}>
                <div className={'gb-auth-card'}>
                    <div className={'gb-auth-logo'}>
                        <img
                            src={logo || '/themes/gobia/img/logo-text-240.png'}
                            srcSet={
                                logo
                                    ? undefined
                                    : '/themes/gobia/img/logo-text-240.png 1x, /themes/gobia/img/logo-text-480.png 2x'
                            }
                            alt={name}
                        />
                    </div>
                    <div className={'gb-auth-box'}>
                        {title && <h1>{title}</h1>}
                        <FlashMessageRender css={tw`mb-3`} />
                        <Form {...props} ref={ref}>
                            <div css={tw`w-full`}>{props.children}</div>
                        </Form>
                    </div>
                </div>
            </div>
            <GobiaFooter />
        </div>
    );
});
