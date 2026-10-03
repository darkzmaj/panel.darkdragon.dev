import * as React from 'react';
import tw from 'twin.macro';
import { useLocation } from 'react-router-dom';
import ContentBox from '@/components/elements/ContentBox';
import MessageBox from '@/components/MessageBox';
import PageContentBlock from '@/components/elements/PageContentBlock';
import UpdateEmailAddressForm from '@/components/dashboard/forms/UpdateEmailAddressForm';
import UpdatePasswordForm from '@/components/dashboard/forms/UpdatePasswordForm';
import ConfigureTwoFactorForm from '@/components/dashboard/forms/ConfigureTwoFactorForm';

export default () => {
    const { state } = useLocation<undefined | { twoFactorRedirect?: boolean }>();

    return (
        <PageContentBlock title={'Security'}>
            {state?.twoFactorRedirect && (
                <MessageBox title={'2-Factor Required'} type={'error'}>
                    Your account must have two-factor authentication enabled in order to continue.
                </MessageBox>
            )}
            <div
                css={[tw`grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10`, state?.twoFactorRedirect ? tw`mt-4` : tw`mt-10`]}
            >
                <ContentBox title={'Email Address'} showFlashes={'account:email'}>
                    <UpdateEmailAddressForm />
                </ContentBox>
                <ContentBox title={'Password'} showFlashes={'account:password'}>
                    <UpdatePasswordForm />
                </ContentBox>
                <ContentBox title={'Two-Factor Authentication'}>
                    <ConfigureTwoFactorForm />
                </ContentBox>
            </div>
        </PageContentBlock>
    );
};
