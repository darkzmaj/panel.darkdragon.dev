import React from 'react';
import Form from '@/components/form/Form';
import { useSiteSettings } from '@/api/settings/queries';
import AuthPreview from '@/gobia/auth/AuthPreview';
import { DEFAULT_LOGO, DEFAULT_LOGO_2X, useBranding } from '@/gobia/branding';

interface Props {
    form: { handleSubmit: () => unknown };
    title?: string;
    subtitle?: string;
    className?: string;
    children: React.ReactNode;
}

/**
 * The sign-in screen of every auth page: a pitch with a live looking preview of the instance list on the left, the
 * logo and the form card on the right. There is no footer here, and the pitch is hidden on phones.
 */
export default function LoginFormContainer({ form, title, subtitle, className, children }: Props) {
    const name = useSiteSettings().name;
    const logo = useBranding('logo');

    return (
        <div className={'gb-auth'}>
            <div className={'gb-auth-split'}>
                <section className={'gb-auth-pitch'}>
                    <div>
                        <h2>Your servers, wherever you are.</h2>
                        <p>Start, watch and manage every instance from one place.</p>
                        <AuthPreview />
                    </div>
                </section>
                <main className={'gb-auth-main'}>
                    <div className={'gb-auth-column'}>
                        <div className={'gb-auth-logo'}>
                            <img
                                src={logo || DEFAULT_LOGO}
                                srcSet={logo ? undefined : `${DEFAULT_LOGO} 1x, ${DEFAULT_LOGO_2X} 2x`}
                                alt={name}
                            />
                        </div>
                        <div className={'gb-auth-box'}>
                            {title && <h1>{title}</h1>}
                            {subtitle && <p>{subtitle}</p>}
                            <Form form={form} className={className}>
                                <div className={'w-full'}>{children}</div>
                            </Form>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
