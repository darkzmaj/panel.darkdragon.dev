import React, { useContext, useEffect, useState } from 'react';
import { ServerContext } from '@/state/server';
import { NavLink, useLocation } from 'react-router-dom';
import { encodePathSegments, hashToPath } from '@/helpers';
import FileActionsContext from '@/components/server/files/FileActionsContext';
import { useDropTarget } from '@/components/server/files/dragDrop';

interface Props {
    withinFileEditor?: boolean;
    isNewFile?: boolean;
}

// One step of the path. It is also a drop target: dragging an entry onto a parent folder moves it up there.
const Crumb = ({ name, path, to }: { name: string; path: string; to?: string }) => {
    const { moveInto, dropFiles } = useContext(FileActionsContext);
    const target = useDropTarget({ directory: path, onMove: moveInto, onFiles: dropFiles });
    const className =
        'gb-crumb' + (target.state === 'ok' ? ' drop-ok' : target.state === 'denied' ? ' drop-denied' : '');

    return to ? (
        <NavLink to={to} className={className} {...target.props}>
            {name}
        </NavLink>
    ) : (
        <span className={className + ' current'} aria-current={'page'} {...target.props}>
            {name}
        </span>
    );
};

export default ({ withinFileEditor, isNewFile }: Props) => {
    const [file, setFile] = useState<string | null>(null);
    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const directory = ServerContext.useStoreState((state) => state.files.directory);
    const { hash } = useLocation();

    useEffect(() => {
        if (withinFileEditor && !isNewFile) setFile(hashToPath(hash).split('/').pop() || null);
    }, [withinFileEditor, isNewFile, hash]);

    const dirs = directory.split('/').filter(Boolean);

    return (
        <nav className={'gb-crumbs'} aria-label={'Current folder'}>
            <Crumb
                name={'container'}
                path={'/'}
                to={dirs.length || withinFileEditor ? `/server/${id}/files` : undefined}
            />
            {dirs.map((name, index) => {
                const path = `/${dirs.slice(0, index + 1).join('/')}`;
                const last = index === dirs.length - 1;

                return (
                    <React.Fragment key={path}>
                        <span className={'gb-crumb-sep'} aria-hidden>
                            /
                        </span>
                        <Crumb
                            name={name}
                            path={path}
                            to={
                                !withinFileEditor && last
                                    ? undefined
                                    : `/server/${id}/files#${encodePathSegments(path)}`
                            }
                        />
                    </React.Fragment>
                );
            })}
            {file && (
                <>
                    <span className={'gb-crumb-sep'} aria-hidden>
                        /
                    </span>
                    <span className={'gb-crumb current'}>{file}</span>
                </>
            )}
        </nav>
    );
};
