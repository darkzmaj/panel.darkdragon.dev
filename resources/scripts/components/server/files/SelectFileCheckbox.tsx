import React from 'react';
import { ServerContext } from '@/state/server';

export const FileActionCheckbox = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} type={'checkbox'} className={'gb-check-input ' + (props.className || '')} />
);

export default ({ name }: { name: string }) => {
    const isChecked = ServerContext.useStoreState((state) => state.files.selectedFiles.indexOf(name) >= 0);
    const appendSelectedFile = ServerContext.useStoreActions((actions) => actions.files.appendSelectedFile);
    const removeSelectedFile = ServerContext.useStoreActions((actions) => actions.files.removeSelectedFile);

    return (
        <label className={'gb-file-check'}>
            <FileActionCheckbox
                name={'selectedFiles'}
                value={name}
                aria-label={`Select ${name}`}
                checked={isChecked}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    if (e.currentTarget.checked) {
                        appendSelectedFile(name);
                    } else {
                        removeSelectedFile(name);
                    }
                }}
            />
        </label>
    );
};
