import React, { memo, useMemo, useState } from 'react';
import { join } from 'pathe';
import isEqual from 'react-fast-compare';
import { useHistory } from 'react-router-dom';
import { Actions, useStoreActions } from 'easy-peasy';
import {
    Archive,
    Copy,
    CopyPlus,
    Download,
    Ellipsis,
    FolderInput,
    FolderOpen,
    Pencil,
    Shield,
    Trash2,
    PackageOpen,
    FileText,
} from 'lucide-react';
import { ApplicationStore } from '@/state';
import { ServerContext } from '@/state/server';
import { encodePathSegments } from '@/helpers';
import { FileObject } from '@/api/server/files/loadDirectory';
import deleteFiles from '@/api/server/files/deleteFiles';
import copyFile from '@/api/server/files/copyFile';
import getFileDownloadUrl from '@/api/server/files/getFileDownloadUrl';
import compressFiles from '@/api/server/files/compressFiles';
import decompressFiles from '@/api/server/files/decompressFiles';
import { usePermissions } from '@/plugins/usePermissions';
import useFlash from '@/plugins/useFlash';
import useEventListener from '@/plugins/useEventListener';
import useFileManagerSwr from '@/plugins/useFileManagerSwr';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import ContextMenu, { MenuItem, MenuState } from '@/components/elements/ContextMenu';
import RenameFileModal from '@/components/server/files/RenameFileModal';
import ChmodFileModal from '@/components/server/files/ChmodFileModal';
import { Dialog } from '@/components/elements/dialog';

type ModalType = 'rename' | 'move' | 'chmod';

export const copyText = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);

        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();

        return ok;
    }
};

// The actions for one row of the file list. It opens from the three-dot button and from a right click on the row
// (the row dispatches an event with the pointer position), and both show the same menu.
const FileDropdownMenu = ({ file }: { file: FileObject }) => {
    const [showSpinner, setShowSpinner] = useState(false);
    const [modal, setModal] = useState<ModalType | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [menu, setMenu] = useState<MenuState | null>(null);

    const history = useHistory();
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const directory = ServerContext.useStoreState((state) => state.files.directory);
    const { mutate } = useFileManagerSwr();
    const { clearAndAddHttpError, clearFlashes } = useFlash();
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);
    const [canUpdate, canCreate, canArchive, canDelete, canRead, canReadContent] = usePermissions([
        'file.update',
        'file.create',
        'file.archive',
        'file.delete',
        'file.read',
        'file.read-content',
    ]);

    const fullPath = join(directory, file.name);

    const run = (task: () => Promise<unknown>, refresh = true) => {
        setShowSpinner(true);
        clearFlashes('files');
        task()
            .then(() => (refresh ? mutate() : undefined))
            .catch((error) => clearAndAddHttpError({ key: 'files', error }))
            .then(() => setShowSpinner(false));
    };

    const doDeletion = () => {
        clearFlashes('files');
        // For UI speed, remove the file from the listing first; a failure reloads the real contents.
        mutate((files) => files.filter((f) => f.key !== file.key), false);
        deleteFiles(uuid, directory, [file.name]).catch((error) => {
            mutate();
            clearAndAddHttpError({ key: 'files', error });
        });
    };

    const items = useMemo((): MenuItem[] => {
        const list: MenuItem[] = [];
        const canOpen = file.isFile ? file.isEditable() && canReadContent : canRead;
        if (canOpen) {
            list.push({
                key: 'open',
                label: 'Open',
                icon: file.isFile ? FileText : FolderOpen,
                onSelect: () =>
                    history.push(`/server/${id}/files${file.isFile ? '/edit' : ''}#${encodePathSegments(fullPath)}`),
            });
        }
        if (canUpdate) {
            list.push({ key: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setModal('rename') });
            list.push({ key: 'move', label: 'Move', icon: FolderInput, onSelect: () => setModal('move') });
        }
        if (file.isFile) {
            list.push({
                key: 'download',
                label: 'Download',
                icon: Download,
                onSelect: () =>
                    run(
                        () =>
                            getFileDownloadUrl(uuid, fullPath).then((url) => {
                                window.location.href = url;
                            }),
                        false
                    ),
            });
            if (canCreate) {
                list.push({
                    key: 'duplicate',
                    label: 'Duplicate',
                    icon: CopyPlus,
                    onSelect: () => run(() => copyFile(uuid, fullPath)),
                });
            }
        }
        list.push({
            key: 'copy-path',
            label: 'Copy path',
            icon: Copy,
            separator: true,
            onSelect: () =>
                copyText(fullPath).then((ok) =>
                    toast({ type: ok ? 'success' : 'error', message: ok ? 'Path copied' : 'Could not copy the path' })
                ),
        });
        if (canUpdate) {
            list.push({ key: 'chmod', label: 'Permissions', icon: Shield, onSelect: () => setModal('chmod') });
        }
        if (file.isArchiveType()) {
            if (canCreate) {
                list.push({
                    key: 'unarchive',
                    label: 'Unarchive',
                    icon: PackageOpen,
                    onSelect: () => run(() => decompressFiles(uuid, directory, file.name)),
                });
            }
        } else if (canArchive) {
            list.push({
                key: 'archive',
                label: 'Archive',
                icon: Archive,
                onSelect: () => run(() => compressFiles(uuid, directory, [file.name])),
            });
        }
        if (canDelete) {
            list.push({
                key: 'delete',
                label: 'Delete',
                icon: Trash2,
                danger: true,
                separator: true,
                onSelect: () => setShowConfirmation(true),
            });
        }

        return list;
    }, [file, uuid, directory, id, canUpdate, canCreate, canArchive, canDelete, canRead, canReadContent]);

    const openMenu = (x: number, y: number) => setMenu({ x, y, items, title: file.name });

    useEventListener(`pterodactyl:files:ctx:${file.key}`, (e: CustomEvent) => {
        openMenu(e.detail?.x ?? 0, e.detail?.y ?? 0);
    });

    return (
        <>
            <Dialog.Confirm
                open={showConfirmation}
                onClose={() => setShowConfirmation(false)}
                title={`Delete ${file.isFile ? 'File' : 'Directory'}`}
                confirm={'Delete'}
                onConfirmed={doDeletion}
            >
                You will not be able to recover the contents of&nbsp;
                <span className={'font-semibold text-gray-50'}>{file.name}</span> once deleted.
            </Dialog.Confirm>
            <button
                type={'button'}
                className={'gb-icon-btn gb-icon-btn-sm gb-row-menu'}
                aria-label={`Actions for ${file.name}`}
                aria-haspopup={'menu'}
                aria-expanded={!!menu}
                onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openMenu(r.right, r.bottom);
                }}
            >
                <Ellipsis aria-hidden />
            </button>
            <ContextMenu menu={menu} onClose={() => setMenu(null)} />
            {modal === 'chmod' ? (
                <ChmodFileModal
                    visible
                    appear
                    files={[{ file: file.name, mode: file.modeBits }]}
                    onDismissed={() => setModal(null)}
                />
            ) : modal ? (
                <RenameFileModal
                    visible
                    appear
                    files={[file.name]}
                    useMoveTerminology={modal === 'move'}
                    onDismissed={() => setModal(null)}
                />
            ) : null}
            <SpinnerOverlay visible={showSpinner} fixed size={'large'} />
        </>
    );
};

export default memo(FileDropdownMenu, isEqual);
