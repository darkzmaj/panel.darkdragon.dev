import React, { useCallback, useEffect, useMemo } from 'react';
import { httpErrorToHuman } from '@/api/http';
import Spinner from '@/components/elements/Spinner';
import FileObjectRow from '@/components/server/files/FileObjectRow';
import FileManagerBreadcrumbs from '@/components/server/files/FileManagerBreadcrumbs';
import { FileObject } from '@/api/server/files/loadDirectory';
import NewDirectoryButton from '@/components/server/files/NewDirectoryButton';
import { NavLink, useLocation } from 'react-router-dom';
import Can from '@/components/elements/Can';
import { ServerError } from '@/components/elements/ScreenBlock';
import { ServerContext } from '@/state/server';
import useFileManagerSwr from '@/plugins/useFileManagerSwr';
import MassActionsBar from '@/components/server/files/MassActionsBar';
import UploadButton from '@/components/server/files/UploadButton';
import { UploadDropZone, UploadPanel, uploadDropped } from '@/components/server/files/UploadPanel';
import { onUploadCompleted } from '@/components/server/files/uploadQueue';
import FileActionsContext from '@/components/server/files/FileActionsContext';
import useMoveEntries from '@/components/server/files/useMoveEntries';
import { usePermissions } from '@/plugins/usePermissions';
import ServerContentBlock from '@/components/elements/ServerContentBlock';
import PageHeader from '@/components/elements/PageHeader';
import { useStoreActions } from '@/state/hooks';
import ErrorBoundary from '@/components/elements/ErrorBoundary';
import { FileActionCheckbox } from '@/components/server/files/SelectFileCheckbox';
import { hashToPath } from '@/helpers';
import { FilePlus } from 'lucide-react';

const sortFiles = (files: FileObject[]): FileObject[] => {
    const sortedFiles: FileObject[] = files
        .sort((a, b) => a.name.localeCompare(b.name))
        .sort((a, b) => (a.isFile === b.isFile ? 0 : a.isFile ? 1 : -1));
    return sortedFiles.filter((file, index) => index === 0 || file.name !== sortedFiles[index - 1].name);
};

export default () => {
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const { hash } = useLocation();
    const { data: files, error, mutate } = useFileManagerSwr();
    const directory = ServerContext.useStoreState((state) => state.files.directory);
    const clearFlashes = useStoreActions((actions) => actions.flashes.clearFlashes);
    const setDirectory = ServerContext.useStoreActions((actions) => actions.files.setDirectory);
    const [canCreate, canUpdate] = usePermissions(['file.create', 'file.update']);

    const setSelectedFiles = ServerContext.useStoreActions((actions) => actions.files.setSelectedFiles);
    const selectedFilesLength = ServerContext.useStoreState((state) => state.files.selectedFiles.length);
    const { move, dialog } = useMoveEntries(uuid);

    useEffect(() => {
        clearFlashes('files');
        setSelectedFiles([]);
        setDirectory(hashToPath(hash));
    }, [hash]);

    useEffect(() => {
        mutate();
    }, [directory]);

    // A finished upload into the folder on screen refreshes the list.
    useEffect(
        () =>
            onUploadCompleted((completedUuid, completedDirectory) => {
                if (completedUuid === uuid && completedDirectory === directory) mutate();
            }),
        [uuid, directory]
    );

    const actions = useMemo(
        () => ({
            canMove: canUpdate,
            moveInto: (payload: { directory: string; names: string[] }, target: string) => {
                if (!canUpdate) return;
                // Show the result at once; if the move fails the revalidation below puts the rows back.
                if (target !== payload.directory) {
                    mutate((current) => current?.filter((f) => !payload.names.includes(f.name)), false);
                }
                move(payload.directory, payload.names, target).then((outcome) => {
                    if (outcome.moved.length) setSelectedFiles([]);
                    mutate();
                });
            },
            dropFiles: (data: DataTransfer, target: string) => {
                if (canCreate) uploadDropped(uuid, data, target);
            },
        }),
        [uuid, canUpdate, canCreate, move]
    );

    const onSelectAllClick = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            setSelectedFiles(e.currentTarget.checked ? files?.map((file) => file.name) || [] : []);
        },
        [files]
    );

    if (error) {
        return <ServerError message={httpErrorToHuman(error)} onRetry={() => mutate()} />;
    }

    return (
        <ServerContentBlock title={'File Manager'} showFlashKey={'files'} heading={false}>
            <FileActionsContext.Provider value={actions}>
                <PageHeader title={'Files'} subtitle={'Browse, upload and edit the files of this instance.'}>
                    <Can action={'file.create'}>
                        <NewDirectoryButton />
                        <UploadButton />
                        <NavLink
                            className={'gb-btn gb-btn-primary gb-btn-sm'}
                            to={`/server/${id}/files/new${window.location.hash}`}
                        >
                            <FilePlus aria-hidden /> New file
                        </NavLink>
                    </Can>
                </PageHeader>
                <ErrorBoundary>
                    <div className={'gb-file-bar'}>
                        <FileActionCheckbox
                            aria-label={'Select all'}
                            checked={files ? selectedFilesLength === (files.length === 0 ? -1 : files.length) : false}
                            onChange={onSelectAllClick}
                        />
                        <FileManagerBreadcrumbs />
                    </div>
                </ErrorBoundary>
                <div className={'gb-list gb-files'}>
                    {!files ? (
                        <Spinner size={'large'} centered />
                    ) : !files.length ? (
                        <p className={'gb-empty'}>
                            This directory is empty.
                            {canCreate && ' Drop files here to upload them.'}
                        </p>
                    ) : (
                        <>
                            {files.length > 250 && (
                                <p className={'gb-empty'}>
                                    This directory is too large to display in the browser, limiting the output to the
                                    first 250 files.
                                </p>
                            )}
                            {sortFiles(files.slice(0, 250)).map((file) => (
                                <FileObjectRow key={file.key} file={file} />
                            ))}
                        </>
                    )}
                </div>
                <MassActionsBar />
                <UploadDropZone uuid={uuid} directory={directory} enabled={canCreate} />
                <UploadPanel />
                {dialog}
            </FileActionsContext.Provider>
        </ServerContentBlock>
    );
};
