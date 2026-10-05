import React, { forwardRef } from 'react';
import { Form } from 'formik';
import FlashMessageRender from '@/components/FlashMessageRender';
import tw from 'twin.macro';
import { useStoreState } from '@/state/hooks';
import AuthPreview from '@/components/auth/AuthPreview';

type Props = React.DetailedHTMLProps<React.FormHTMLAttributes<HTMLFormElement>, HTMLFormElement> & {
    title?: string;
    subtitle?: string;
};

// The sign-in screen: logo centred at the top, a short pitch with a preview of the instance list on the left and the
// form card on the right. There is no footer here, and the left side is hidden on phones.
export default forwardRef<HTMLFormElement, Props>(({ title, subtitle, ...props }, ref) => {
    const logo = useStoreState((state) => state.settings.data?.logo);
    const name = useStoreState((state) => state.settings.data?.name) || 'Gobia Cloud';

    return (
        <div className={'gb-auth'}>
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
            <div className={'gb-auth-split'}>
                <section className={'gb-auth-pitch'}>
                    <div>
                        <h2>Your servers, wherever you are.</h2>
                        <p>Start, watch and manage every instance from one place.</p>
                        <AuthPreview />
                    </div>
                </section>
                <main className={'gb-auth-main'}>
                    <div className={'gb-auth-box'}>
                        {title && <h1>{title}</h1>}
                        {subtitle && <p>{subtitle}</p>}
                        <FlashMessageRender css={tw`mb-3`} />
                        <Form {...props} ref={ref}>
                            <div css={tw`w-full`}>{props.children}</div>
                        </Form>
                    </div>
                </main>
            </div>
        </div>
    );
});
