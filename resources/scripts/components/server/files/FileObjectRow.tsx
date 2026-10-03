import React, { memo, useContext } from 'react';
import { Archive, File as FileIcon, FileInput, Folder } from 'lucide-react';
import { encodePathSegments } from '@/helpers';
import { differenceInHours, format, formatDistanceToNow } from 'date-fns';
import { FileObject } from '@/api/server/files/loadDirectory';
import FileDropdownMenu from '@/components/server/files/FileDropdownMenu';
import { ServerContext } from '@/state/server';
import { NavLink, useRouteMatch } from 'react-router-dom';
import isEqual from 'react-fast-compare';
import SelectFileCheckbox from '@/components/server/files/SelectFileCheckbox';
import { usePermissions } from '@/plugins/usePermissions';
import { join } from 'pathe';
import { bytesToString } from '@/lib/formatters';
import FileActionsContext from '@/components/server/files/FileActionsContext';
import { beginDrag, endDrag, useDropTarget } from '@/components/server/files/dragDrop';

const Clickable: React.FC<{ file: FileObject }> = memo(({ file, children }) => {
    const [canRead] = usePermissions(['file.read']);
    const [canReadContents] = usePermissions(['file.read-content']);
    const directory = ServerContext.useStoreState((state) => state.files.directory);

    const match = useRouteMatch();

    return (file.isFile && (!file.isEditable() || !canReadContents)) || (!file.isFile && !canRead) ? (
        <div className={'gb-file-details'}>{children}</div>
    ) : (
        <NavLink
            className={'gb-file-details'}
            draggable={false}
            to={`${match.url}${file.isFile ? '/edit' : ''}#${encodePathSegments(join(directory, file.name))}`}
        >
            {children}
        </NavLink>
    );
}, isEqual);

const FileObjectRow = ({ file }: { file: FileObject }) => {
    const store = ServerContext.useStore();
    const directory = ServerContext.useStoreState((state) => state.files.directory);
    const { moveInto, dropFiles, canMove } = useContext(FileActionsContext);
    const target = useDropTarget({
        directory: join(directory, file.name),
        enabled: !file.isFile,
        onMove: moveInto,
        onFiles: dropFiles,
    });

    return (
        <div
            {...(file.isFile ? {} : target.props)}
            className={
                'gb-file-row' + (target.state === 'ok' ? ' drop-ok' : target.state === 'denied' ? ' drop-denied' : '')
            }
            draggable={canMove}
            data-name={file.name}
            onDragStart={(e) => {
                const selected = store.getState().files.selectedFiles;
                const names = selected.includes(file.name) ? selected : [file.name];
                beginDrag(e, { directory, names });
            }}
            onDragEnd={endDrag}
            onContextMenu={(e) => {
                e.preventDefault();
                window.dispatchEvent(
                    new CustomEvent(`pterodactyl:files:ctx:${file.key}`, { detail: { x: e.clientX, y: e.clientY } })
                );
            }}
        >
            <SelectFileCheckbox name={file.name} />
            <Clickable file={file}>
                <span className={'gb-file-icon'}>
                    {file.isFile ? (
                        file.isSymlink ? (
                            <FileInput aria-hidden />
                        ) : file.isArchiveType() ? (
                            <Archive aria-hidden />
                        ) : (
                            <FileIcon aria-hidden />
                        )
                    ) : (
                        <Folder aria-hidden />
                    )}
                </span>
                <span className={'gb-file-name'}>{file.name}</span>
                <span className={'gb-file-size'}>{file.isFile ? bytesToString(file.size) : ''}</span>
                <span className={'gb-file-date'} title={file.modifiedAt.toString()}>
                    {Math.abs(differenceInHours(file.modifiedAt, new Date())) > 48
                        ? format(file.modifiedAt, 'MMM do, yyyy h:mma')
                        : formatDistanceToNow(file.modifiedAt, { addSuffix: true })}
                </span>
            </Clickable>
            <FileDropdownMenu file={file} />
        </div>
    );
};

export default memo(FileObjectRow, (prevProps, nextProps) => {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const { isArchiveType, isEditable, ...prevFile } = prevProps.file;
    const { isArchiveType: nextIsArchiveType, isEditable: nextIsEditable, ...nextFile } = nextProps.file;
    /* eslint-enable @typescript-eslint/no-unused-vars */

    return isEqual(prevFile, nextFile);
});
