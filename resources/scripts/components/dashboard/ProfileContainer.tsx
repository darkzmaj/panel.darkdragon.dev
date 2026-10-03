import * as React from 'react';
import tw from 'twin.macro';
import ContentBox from '@/components/elements/ContentBox';
import PageContentBlock from '@/components/elements/PageContentBlock';
import UpdateAvatarForm from '@/components/dashboard/forms/UpdateAvatarForm';
import UpdateUsernameForm from '@/components/dashboard/forms/UpdateUsernameForm';

export default () => (
    <PageContentBlock title={'Profile'}>
        <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-8 mt-10 mb-10 max-w-4xl`}>
            <ContentBox title={'Profile Picture'} showFlashes={'account:avatar'}>
                <UpdateAvatarForm />
            </ContentBox>
            <ContentBox title={'Username'} showFlashes={'account:username'}>
                <UpdateUsernameForm />
            </ContentBox>
        </div>
    </PageContentBlock>
);
