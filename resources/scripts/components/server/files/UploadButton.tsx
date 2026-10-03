import React, { useRef } from 'react';
import { FolderUp, Upload } from 'lucide-react';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { ServerContext } from '@/state/server';
import { uploadPicked } from '@/components/server/files/UploadPanel';

// Picks files or a whole folder and hands them to the shared upload queue, which shows progress in the upload panel.
export default () => {
    const files = useRef<HTMLInputElement>(null);
    const folder = useRef<HTMLInputElement>(null);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const directory = ServerContext.useStoreState((state) => state.files.directory);
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);

    const onPick = (input: HTMLInputElement) => {
        if (!input.files?.length) return;
        const count = uploadPicked(uuid, input.files, directory);
        if (!count) toast({ type: 'error', message: 'Nothing could be uploaded from that selection.' });
        input.value = '';
    };

    return (
        <>
            <input ref={files} type={'file'} multiple hidden onChange={(e) => onPick(e.currentTarget)} />
            <input
                ref={folder}
                type={'file'}
                hidden
                // Not part of the standard typings, but supported by every current browser.
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => onPick(e.currentTarget)}
            />
            <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => files.current?.click()}>
                <Upload aria-hidden /> Upload
            </button>
            <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => folder.current?.click()}>
                <FolderUp aria-hidden /> Folder
            </button>
        </>
    );
};
