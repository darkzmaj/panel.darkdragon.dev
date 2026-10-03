import React, { useEffect, useState } from 'react';
import { Server } from '@/api/server/getServer';
import getServers from '@/api/getServers';
import Spinner from '@/components/elements/Spinner';
import PageContentBlock from '@/components/elements/PageContentBlock';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from 'easy-peasy';
import { usePersistedState } from '@/plugins/usePersistedState';
import Switch from '@/components/elements/Switch';
import tw from 'twin.macro';
import useSWR from 'swr';
import { PaginatedResult } from '@/api/http';
import Pagination from '@/components/elements/Pagination';
import { useLocation } from 'react-router-dom';
import { getLayout, saveCategoryOrder, saveOrder, ServerLayout } from '@/api/account/layout';
import ServerFilterBar, { ServerFilter } from '@/components/dashboard/ServerFilterBar';
import SortableServerList from '@/components/dashboard/SortableServerList';
import CategoryEditorModal from '@/components/dashboard/CategoryEditorModal';

export default () => {
    const { search } = useLocation();
    const defaultPage = Number(new URLSearchParams(search).get('page') || '1');

    const [page, setPage] = useState(!isNaN(defaultPage) && defaultPage > 0 ? defaultPage : 1);
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const uuid = useStoreState((state) => state.user.data!.uuid);
    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const [showOnlyAdmin, setShowOnlyAdmin] = usePersistedState(`${uuid}:show_all_servers`, false);
    const [filter, setFilter] = useState<ServerFilter>({ kind: 'all' });
    const [editing, setEditing] = useState(false);
    const adminView = !!(showOnlyAdmin && rootAdmin);

    // Only the categories and the list of selectable servers come from here, so it is not refetched on every focus.
    const { data: layout, mutate: mutateLayout } = useSWR<ServerLayout>('/api/client/account/layout', getLayout, {
        revalidateOnFocus: false,
    });

    const categoryId = filter.kind === 'category' ? filter.id : undefined;
    const type = adminView ? 'admin' : filter.kind === 'you' ? 'owner' : undefined;

    const {
        data: servers,
        error,
        mutate,
    } = useSWR<PaginatedResult<Server>>(['/api/client/servers', type, categoryId, page], () =>
        getServers({ page, type, category: adminView ? undefined : categoryId })
    );

    useEffect(() => {
        setPage(1);
    }, [showOnlyAdmin, filter]);

    // A category that was deleted or renamed away must not stay selected.
    useEffect(() => {
        if (layout && filter.kind === 'category' && !layout.categories.some((c) => c.id === filter.id)) {
            setFilter({ kind: 'all' });
        }
    }, [layout]);

    useEffect(() => {
        if (!servers) return;
        if (servers.pagination.currentPage > 1 && !servers.items.length) {
            setPage(1);
        }
    }, [servers?.pagination.currentPage]);

    useEffect(() => {
        // Don't use react-router to handle changing this part of the URL, otherwise it
        // triggers a needless re-render. We just want to track this in the URL incase the
        // user refreshes the page.
        window.history.replaceState(null, document.title, `/${page <= 1 ? '' : `?page=${page}`}`);
    }, [page]);

    useEffect(() => {
        if (error) clearAndAddHttpError({ key: 'dashboard', error });
        if (!error) clearFlashes('dashboard');
    }, [error]);

    // Shows the new order immediately, then stores it; if storing fails the real order is fetched again.
    const reorder = (items: Server[]) => {
        if (!servers) return;

        mutate({ ...servers, items }, false);
        const uuids = items.map((s) => s.uuid);
        (categoryId ? saveCategoryOrder(categoryId, uuids) : saveOrder(uuids))
            .then((fresh) => mutateLayout(fresh, false))
            .catch((e) => {
                clearAndAddHttpError({ key: 'dashboard', error: e });
                mutate();
            });
    };

    return (
        <PageContentBlock title={'Dashboard'} showFlashKey={'dashboard'}>
            <div css={tw`flex items-center mb-2`}>
                <div css={tw`flex-1 min-w-0`}>
                    {!adminView && (
                        <ServerFilterBar
                            filter={filter}
                            categories={layout?.categories || []}
                            onChange={setFilter}
                            onEdit={() => setEditing(true)}
                        />
                    )}
                </div>
                {rootAdmin && (
                    <div css={tw`flex justify-end items-center mb-3 ml-4 flex-none`}>
                        <p css={tw`uppercase text-xs text-neutral-400 mr-2`}>
                            {showOnlyAdmin ? "Showing others' servers" : 'Showing your servers'}
                        </p>
                        <Switch
                            name={'show_all_servers'}
                            defaultChecked={showOnlyAdmin}
                            onChange={() => setShowOnlyAdmin((s) => !s)}
                        />
                    </div>
                )}
            </div>
            {!servers ? (
                <Spinner centered size={'large'} />
            ) : (
                <Pagination data={servers} onPageSelect={setPage}>
                    {({ items }) =>
                        items.length > 0 ? (
                            <SortableServerList servers={items} onReorder={adminView ? undefined : reorder} />
                        ) : (
                            <p css={tw`text-center text-sm text-neutral-400`}>
                                {showOnlyAdmin
                                    ? 'There are no other servers to display.'
                                    : filter.kind === 'category'
                                    ? 'This category has no servers you can access. Use the pencil to add some.'
                                    : filter.kind === 'you'
                                    ? 'You do not own any servers.'
                                    : 'There are no servers associated with your account.'}
                            </p>
                        )
                    }
                </Pagination>
            )}
            <CategoryEditorModal
                visible={editing}
                layout={layout}
                onClose={() => setEditing(false)}
                onChanged={(fresh) => {
                    // Membership changes alter what a category view lists, so refetch both.
                    fresh ? mutateLayout(fresh, false) : mutateLayout();
                    mutate();
                }}
            />
        </PageContentBlock>
    );
};
