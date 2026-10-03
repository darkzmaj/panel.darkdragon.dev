import * as React from 'react';
import ContentBox from '@/components/elements/ContentBox';
import PageContentBlock from '@/components/elements/PageContentBlock';
import PageHeader from '@/components/elements/PageHeader';
import UpdateAvatarForm from '@/components/dashboard/forms/UpdateAvatarForm';
import UpdateUsernameForm from '@/components/dashboard/forms/UpdateUsernameForm';

export default () => (
    <PageContentBlock title={'Profile'}>
        <PageHeader title={'Profile'} subtitle={'Update the identity shown across the Panel.'} />
        <div className={'grid grid-cols-1 xl:grid-cols-2 gap-4'}>
            <ContentBox
                title={'Profile Picture'}
                description={'PNG images up to 2 MB. You can crop before saving.'}
                showFlashes={'account:avatar'}
                className={'gb-stack-reset'}
            >
                <UpdateAvatarForm />
            </ContentBox>
            <ContentBox
                title={'Username'}
                description={'Used to sign in and shown to people you share instances with.'}
                showFlashes={'account:username'}
            >
                <UpdateUsernameForm />
            </ContentBox>
        </div>
    </PageContentBlock>
);
