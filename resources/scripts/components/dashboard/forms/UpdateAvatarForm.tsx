import React, { useRef, useState } from 'react';
import { Actions, useStoreActions, useStoreState } from 'easy-peasy';
import tw from 'twin.macro';
import { ApplicationStore } from '@/state';
import { httpErrorToHuman } from '@/api/http';
import Avatar from '@/components/Avatar';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import { Button } from '@/components/elements/button/index';

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

export default () => {
    const input = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const hasAvatar = useStoreState((state: ApplicationStore) => !!state.user.data?.avatarUrl);
    const { uploadAvatar, removeAvatar } = useStoreActions((actions: Actions<ApplicationStore>) => actions.user);
    const { clearFlashes, addFlash } = useStoreActions((actions: Actions<ApplicationStore>) => actions.flashes);

    const run = (action: Promise<void>, message: string) => {
        setLoading(true);
        clearFlashes('account:avatar');

        action
            .then(() => addFlash({ type: 'success', key: 'account:avatar', message }))
            .catch((error) =>
                addFlash({ type: 'error', key: 'account:avatar', title: 'Error', message: httpErrorToHuman(error) })
            )
            .then(() => setLoading(false));
    };

    const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;

        // The server performs the authoritative checks, this just avoids a pointless upload.
        if (file.type !== 'image/png' || file.size > MAX_SIZE_BYTES) {
            clearFlashes('account:avatar');
            addFlash({
                type: 'error',
                key: 'account:avatar',
                title: 'Error',
                message: 'Profile pictures must be PNG images no larger than 2 MB.',
            });

            return;
        }

        run(uploadAvatar(file), 'Your profile picture has been updated.');
    };

    return (
        <div css={tw`relative flex items-center`}>
            <SpinnerOverlay size={'large'} visible={loading} />
            <div css={tw`flex-none w-20 h-20 rounded-full bg-neutral-600 overflow-hidden`}>
                <Avatar.User size={80} />
            </div>
            <div css={tw`ml-6`}>
                <input ref={input} type={'file'} accept={'image/png'} css={tw`hidden`} onChange={onSelect} />
                <Button type={'button'} disabled={loading} onClick={() => input.current?.click()}>
                    {hasAvatar ? 'Replace Picture' : 'Upload Picture'}
                </Button>
                {hasAvatar && (
                    <Button.Text
                        type={'button'}
                        css={tw`ml-2`}
                        disabled={loading}
                        onClick={() => run(removeAvatar(), 'Your profile picture has been removed.')}
                    >
                        Remove
                    </Button.Text>
                )}
                <p css={tw`text-xs text-neutral-400 mt-2`}>PNG only, up to 2 MB.</p>
            </div>
        </div>
    );
};
