import ContentBox from '@/components/elements/ContentBox';
import UpdatePasswordForm from '@/components/dashboard/forms/UpdatePasswordForm';
import UpdateEmailAddressForm from '@/components/dashboard/forms/UpdateEmailAddressForm';
import ConfigureTwoFactorForm from '@/components/dashboard/forms/ConfigureTwoFactorForm';
import PageContentBlock from '@/components/elements/PageContentBlock';
import { Alert } from '@/components/elements/alert';
import { useLocation } from '@tanstack/react-router';
import Slot from '@/extensions/Slot';
import PageHeading from '@/components/elements/PageHeading';

/** Security: email, password and two-factor authentication, two cards per row like the Gobia 1.x page. */
export default function AccountOverviewContainer() {
    const state = useLocation().state as { twoFactorRedirect?: boolean } | null;

    return (
        <PageContentBlock title={'Security'}>
            <PageHeading title={'Security'} description={'Email, password and two-factor authentication.'} />
            {state?.twoFactorRedirect && (
                <Alert title={'2-Factor Required'} type={'danger'} className={'mb-4'}>
                    Your account must have two-factor authentication enabled in order to continue.
                </Alert>
            )}

            <Slot name={'account.overview.before'} />
            <div className={'grid grid-cols-1 gap-4 xl:grid-cols-2'}>
                <ContentBox title={'Email Address'}>
                    <UpdateEmailAddressForm />
                </ContentBox>
                <ContentBox title={'Password'}>
                    <UpdatePasswordForm />
                </ContentBox>
                <ContentBox title={'Two-Factor Authentication'}>
                    <ConfigureTwoFactorForm />
                </ContentBox>
            </div>
            <Slot name={'account.overview.after'} />
        </PageContentBlock>
    );
}
