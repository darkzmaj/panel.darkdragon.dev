import React, { useCallback, useEffect, useRef, useState } from 'react';
import tw from 'twin.macro';
import { join } from 'pathe';
import { FontAwesomeIcon } from '@/components/elements/icons';
import { faChevronDown, faChevronRight, faFile, faFolder, faFolderOpen } from '@/components/elements/icons';
import loadDirectory, { FileObject } from '@/api/server/files/loadDirectory';
import { httpErrorToHuman } from '@/api/http';

export interface Selection {
    path: string;
    isDirectory: boolean;
}

interface Props {
    uuid: string;
    selection: Selection | null;
    activePath: string | null;
    openPaths: string[];
    dirtyPaths: string[];
    // Changes whenever the contents of a directory may have changed (create, rename, upload...).
    refreshToken: { directory: string; n: number };
    onSelect: (selection: Selection) => void;
    onOpen: (path: string) => void;
}

type Listing = { items: FileObject[] } | { error: string } | 'loading';

const sortEntries = (items: FileObject[]) =>
    [...items].sort((a, b) =>
        a.isFile === b.isFile ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isFile ? 1 : -1
    );

export default ({ uuid, selection, activePath, openPaths, dirtyPaths, refreshToken, onSelect, onOpen }: Props) => {
    const [listings, setListings] = useState<Record<string, Listing>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']));
    const latest = useRef(listings);
    latest.current = listings;

    const load = useCallback(
        (directory: string) => {
            setListings((l) => ({
                ...l,
                [directory]: l[directory] && typeof l[directory] !== 'string' ? l[directory] : 'loading',
            }));
            loadDirectory(uuid, directory)
                .then((items) => setListings((l) => ({ ...l, [directory]: { items: sortEntries(items) } })))
                .catch((e) => setListings((l) => ({ ...l, [directory]: { error: httpErrorToHuman(e) } })));
        },
        [uuid]
    );

    useEffect(() => {
        load('/');
    }, [uuid]);

    useEffect(() => {
        if (refreshToken.n > 0 && refreshToken.directory in latest.current) load(refreshToken.directory);
    }, [refreshToken]);

    const toggle = (path: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
                if (!(path in latest.current)) load(path);
            }

            return next;
        });
    };

    const renderDirectory = (directory: string, depth: number): React.ReactNode => {
        const listing = listings[directory];
        if (!listing || listing === 'loading') {
            return (
                <li style={{ paddingLeft: depth * 12 + 24 }} css={tw`py-1 text-xs text-neutral-500`}>
                    Loading&hellip;
                </li>
            );
        }
        if ('error' in listing) {
            return (
                <li style={{ paddingLeft: depth * 12 + 24 }} css={tw`py-1 text-xs text-red-400`}>
                    {listing.error}
                </li>
            );
        }
        if (listing.items.length === 0) {
            return (
                <li style={{ paddingLeft: depth * 12 + 24 }} css={tw`py-1 text-xs text-neutral-500`}>
                    Empty
                </li>
            );
        }

        return listing.items.map((item) => {
            const path = join(directory, item.name);
            const isSelected = selection?.path === path;

            if (!item.isFile) {
                const isOpen = expanded.has(path);

                return (
                    <li key={path} role={'treeitem'} aria-expanded={isOpen} aria-selected={isSelected}>
                        <button
                            type={'button'}
                            onClick={() => {
                                onSelect({ path, isDirectory: true });
                                toggle(path);
                            }}
                            style={{ paddingLeft: depth * 12 + 6 }}
                            css={[
                                tw`flex items-center w-full text-left py-1 pr-2 text-sm hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700`,
                                isSelected && tw`bg-neutral-700`,
                            ]}
                        >
                            <FontAwesomeIcon
                                icon={isOpen ? faChevronDown : faChevronRight}
                                fixedWidth
                                css={tw`text-xs text-neutral-400`}
                            />
                            <FontAwesomeIcon
                                icon={isOpen ? faFolderOpen : faFolder}
                                fixedWidth
                                css={tw`mx-1 text-yellow-500`}
                            />
                            <span css={tw`truncate`}>{item.name}</span>
                        </button>
                        {isOpen && <ul role={'group'}>{renderDirectory(path, depth + 1)}</ul>}
                    </li>
                );
            }

            const isActive = activePath === path;

            return (
                <li key={path} role={'treeitem'} aria-selected={isSelected}>
                    <button
                        type={'button'}
                        onClick={() => {
                            onSelect({ path, isDirectory: false });
                            onOpen(path);
                        }}
                        style={{ paddingLeft: depth * 12 + 24 }}
                        title={item.isEditable() ? path : `${path} (cannot be edited as text)`}
                        css={[
                            tw`flex items-center w-full text-left py-1 pr-2 text-sm hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700`,
                            (isActive || isSelected) && tw`bg-neutral-700`,
                            !item.isEditable() && tw`text-neutral-500`,
                        ]}
                    >
                        <FontAwesomeIcon icon={faFile} fixedWidth css={tw`mr-1 text-neutral-400`} />
                        <span css={[tw`truncate flex-1`, openPaths.includes(path) && tw`text-neutral-100`]}>
                            {item.name}
                        </span>
                        {dirtyPaths.includes(path) && (
                            <span aria-label={'unsaved changes'} css={tw`ml-1 text-cyan-400`}>
                                &bull;
                            </span>
                        )}
                    </button>
                </li>
            );
        });
    };

    return (
        <ul role={'tree'} aria-label={'Server files'} css={tw`text-neutral-300`}>
            <li role={'treeitem'} aria-expanded aria-selected={selection?.path === '/'}>
                <button
                    type={'button'}
                    onClick={() => onSelect({ path: '/', isDirectory: true })}
                    css={[
                        tw`flex items-center w-full text-left py-1 px-2 text-sm font-medium hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700`,
                        selection?.path === '/' && tw`bg-neutral-700`,
                    ]}
                >
                    <FontAwesomeIcon icon={faFolderOpen} fixedWidth css={tw`mr-1 text-yellow-500`} />
                    /home/container
                </button>
                <ul role={'group'}>{renderDirectory('/', 0)}</ul>
            </li>
        </ul>
    );
};
