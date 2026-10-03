import React, { useEffect, useState } from 'react';
import { Actions, useStoreActions } from 'easy-peasy';
import tw from 'twin.macro';
import PageHeader from '@/components/elements/PageHeader';
import { Plus } from 'lucide-react';
import { useStoreState } from 'easy-peasy';
import CreateInstanceModal from '@/components/dashboard/create/CreateInstanceModal';
import useSWR from 'swr';
import { useLocation } from 'react-router-dom';
import { Server } from '@/api/server/getServer';
import getServers from '@/api/getServers';
import { ApplicationStore } from '@/state';
import { httpErrorToHuman, PaginatedResult } from '@/api/http';
import PageContentBlock from '@/components/elements/PageContentBlock';
import Pagination from '@/components/elements/Pagination';
import { SkeletonRows } from '@/components/elements/Skeleton';
import { getLayout, saveCategoryOrder, saveOrder, ServerLayout } from '@/api/account/layout';
import ServerFilterBar, { ServerFilter } from '@/components/dashboard/ServerFilterBar';
import SortableServerList from '@/components/dashboard/SortableServerList';
import CategoryEditorModal from '@/components/dashboard/CategoryEditorModal';

const EMPTY: Record<ServerFilter['kind'], string> = {
    all: 'There are no servers associated with your account.',
    you: 'You do not own any servers.',
    other: 'Nobody has shared a server with you.',
    category: 'This category has no servers you can access. Use the pencil to add some.',
};

export default () => {
    const { search } = useLocation();
    const defaultPage = Number(new URLSearchParams(search).get('page') || '1');
    const [page, setPage] = useState(!isNaN(defaultPage) && defaultPage > 0 ? defaultPage : 1);
    const [filter, setFilter] = useState<ServerFilter>({ kind: 'all' });
    const [editing, setEditing] = useState(false);
    const [creating, setCreating] = useState(false);
    const rootAdmin = useStoreState((state: ApplicationStore) => state.user.data!.rootAdmin);
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);

    // Categories and the servers that can be put in them. Not refetched on focus; changes arrive through mutate().
    const {
        data: layout,
        error: layoutError,
        mutate: mutateLayout,
    } = useSWR<ServerLayout>('/api/client/account/layout', getLayout, { revalidateOnFocus: false });

    const categoryId = filter.kind === 'category' ? filter.id : undefined;
    const type = filter.kind === 'you' ? 'owner' : filter.kind === 'other' ? 'other' : undefined;

    const {
        data: servers,
        error,
        mutate,
    } = useSWR<PaginatedResult<Server>>(
        ['/api/client/servers', type, categoryId, page],
        () => getServers({ page, type, category: categoryId }),
        {
            revalidateOnFocus: false,
        }
    );

    useEffect(() => setPage(1), [filter]);

    // A category that was deleted must not stay selected.
    useEffect(() => {
        if (layout && filter.kind === 'category' && !layout.categories.some((c) => c.id === filter.id)) {
            setFilter({ kind: 'all' });
        }
    }, [layout]);

    useEffect(() => {
        if (servers && servers.pagination.currentPage > 1 && !servers.items.length) setPage(1);
    }, [servers?.pagination.currentPage]);

    useEffect(() => {
        // Not routed through react-router on purpose: it would remount the page. This only keeps ?page in the URL.
        window.history.replaceState(null, document.title, `/${page <= 1 ? '' : `?page=${page}`}`);
    }, [page]);

    // Shows the new order at once; if it cannot be stored the previous order is restored and the user is told.
    const reorder = (items: Server[]) => {
        if (!servers) return;
        const previous = servers;

        mutate({ ...servers, items }, false);
        const uuids = items.map((s) => s.uuid);
        (categoryId ? saveCategoryOrder(categoryId, uuids) : saveOrder(uuids))
            .then((fresh) => mutateLayout(fresh, false))
            .catch(() => {
                mutate(previous, false);
                toast({ type: 'error', message: 'Could not save the server order. Your previous order is unchanged.' });
            });
    };

    return (
        <PageContentBlock title={'Dashboard'}>
            <PageHeader title={'Instances'} subtitle={'Everything you own or have been given access to.'}>
                {rootAdmin && (
                    <button type={'button'} className={'gb-btn gb-btn-primary'} onClick={() => setCreating(true)}>
                        <Plus aria-hidden /> Create Instance
                    </button>
                )}
            </PageHeader>
            <div css={tw`mb-4`}>
                {layoutError ? (
                    <p css={tw`text-sm text-red-300`}>
                        Could not load your categories.{' '}
                        <button type={'button'} css={tw`underline`} onClick={() => mutateLayout()}>
                            Retry
                        </button>
                    </p>
                ) : (
                    <ServerFilterBar
                        filter={filter}
                        categories={layout?.categories || []}
                        onChange={setFilter}
                        onEdit={() => setEditing(true)}
                    />
                )}
            </div>

            {error ? (
                <div css={tw`text-center py-10`} role={'alert'}>
                    <p css={tw`text-sm text-red-300 mb-3`}>Could not load servers. {httpErrorToHuman(error)}</p>
                    <button type={'button'} css={tw`text-sm underline`} onClick={() => mutate()}>
                        Retry
                    </button>
                </div>
            ) : !servers ? (
                <SkeletonRows count={4} className={'h-[5.5rem]'} />
            ) : (
                <Pagination data={servers} onPageSelect={setPage}>
                    {({ items }) =>
                        items.length > 0 ? (
                            <SortableServerList servers={items} onReorder={reorder} />
                        ) : (
                            <p className={'gb-list'} css={tw`text-center text-sm text-neutral-400 py-10`}>
                                {EMPTY[filter.kind]}
                            </p>
                        )
                    }
                </Pagination>
            )}

            {rootAdmin && (
                <CreateInstanceModal visible={creating} onClose={() => setCreating(false)} onCreated={() => mutate()} />
            )}
            <CategoryEditorModal
                visible={editing}
                layout={layout}
                onClose={() => setEditing(false)}
                onChanged={(fresh, deleted) => {
                    // Leave a deleted category first: the list below must never be refetched for an id that no longer exists.
                    if (deleted !== undefined && filter.kind === 'category' && filter.id === deleted) {
                        setFilter({ kind: 'all' });
                    }
                    // Membership changes alter what a category view lists, so refetch both.
                    fresh ? mutateLayout(fresh, false) : mutateLayout();
                    mutate();
                }}
            />
        </PageContentBlock>
    );
};
