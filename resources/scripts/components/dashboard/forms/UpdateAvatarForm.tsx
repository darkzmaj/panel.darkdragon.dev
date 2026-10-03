import React, { useRef, useState } from 'react';
import { Actions, useStoreActions, useStoreState } from 'easy-peasy';
import tw from 'twin.macro';
import { ApplicationStore } from '@/state';
import { httpErrorToHuman } from '@/api/http';
import Avatar from '@/components/Avatar';
import AvatarCropperModal from '@/components/dashboard/forms/AvatarCropperModal';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import { Button } from '@/components/elements/button/index';

// The cropped result is what gets uploaded (and limited to 2 MB by the server), so the source may be larger.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export default () => {
    const input = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const [pending, setPending] = useState<File | null>(null);
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

    const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;

        // The server performs the authoritative checks; this avoids opening the editor for something that can't be used.
        const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => signature[i] === byte);
        if (!isPng || file.size > MAX_SOURCE_BYTES) {
            clearFlashes('account:avatar');
            addFlash({
                type: 'error',
                key: 'account:avatar',
                title: 'Error',
                message: 'Profile pictures must be PNG images no larger than 20 MB.',
            });

            return;
        }

        clearFlashes('account:avatar');
        setPending(file);
    };

    return (
        <div css={tw`relative flex items-center`}>
            <AvatarCropperModal
                file={pending}
                onCancel={() => setPending(null)}
                onConfirm={(cropped) => {
                    setPending(null);
                    run(uploadAvatar(cropped), 'Your profile picture has been updated.');
                }}
            />
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
                <p css={tw`text-xs text-neutral-400 mt-2`}>PNG only. You can crop it after choosing a file.</p>
            </div>
        </div>
    );
};
