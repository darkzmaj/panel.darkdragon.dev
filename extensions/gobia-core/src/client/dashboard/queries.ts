import { http } from '@pterodactyl/sdk';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Category, CategoryFilter, InstancePage, ListParams, Summary } from './types';

const BASE = '/api/client/extensions/gobia-core';

export const keys = {
    all: ['gobia-core', 'instances'] as const,
    list: (params: ListParams) => ['gobia-core', 'instances', 'list', params] as const,
    summary: ['gobia-core', 'instances', 'summary'] as const,
};

interface ListQuery {
    view: string;
    page: number;
    per_page: number;
    category?: number | 'none';
    q?: string;
}

function listQuery(params: ListParams): ListQuery {
    const query: ListQuery = { view: params.view, page: params.page, per_page: 30 };
    if (params.category !== null) query.category = params.category;
    if (params.q.trim() !== '') query.q = params.q.trim();
    return query;
}

export function useInstances(params: ListParams) {
    return useQuery({
        queryKey: keys.list(params),
        queryFn: async () => (await http.get<InstancePage>(`${BASE}/servers`, { params: listQuery(params) })).data,
        placeholderData: keepPreviousData,
        staleTime: 15_000,
    });
}

export function useSummary() {
    return useQuery({
        queryKey: keys.summary,
        queryFn: async () => (await http.get<Summary>(`${BASE}/servers/summary`)).data,
        staleTime: 15_000,
    });
}

/** Lists and the summary both depend on categories and order; refetch only the active ones. */
export function invalidateInstances(queryClient: QueryClient) {
    return queryClient.invalidateQueries({ queryKey: keys.all });
}

export function useReorder() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ category, servers }: { category: CategoryFilter; servers: string[] }) =>
            http.put(`${BASE}/servers/order`, {
                category: category === null || category === 'none' ? null : category,
                servers,
            }),
        onSettled: () => invalidateInstances(queryClient),
    });
}

export function useSetIconColor() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ uuid, color }: { uuid: string; color: string | null }) =>
            (
                await http.put<{ icon_color: string | null; recent_icon_colors: string[] }>(
                    `${BASE}/servers/${uuid}/icon-color`,
                    { color }
                )
            ).data,
        onSuccess: (result, { uuid }) => {
            // Patch the cached pages in place so one colour change does not refetch every list.
            queryClient.setQueriesData<InstancePage>({ queryKey: ['gobia-core', 'instances', 'list'] }, (page) =>
                page
                    ? {
                          ...page,
                          data: page.data.map((item) =>
                              item.uuid === uuid ? { ...item, icon_color: result.icon_color } : item
                          ),
                      }
                    : page
            );
            queryClient.setQueryData<Summary>(keys.summary, (summary) =>
                summary ? { ...summary, recent_icon_colors: result.recent_icon_colors } : summary
            );
        },
    });
}

export function useCategoryActions() {
    const queryClient = useQueryClient();
    const done = () => invalidateInstances(queryClient);
    return {
        create: useMutation({
            mutationFn: async (name: string) => (await http.post<Category>(`${BASE}/categories`, { name })).data,
            onSuccess: done,
        }),
        rename: useMutation({
            mutationFn: async ({ id, name }: { id: number; name: string }) =>
                http.put(`${BASE}/categories/${id}`, { name }),
            onSuccess: done,
        }),
        remove: useMutation({
            mutationFn: async (id: number) => http.delete(`${BASE}/categories/${id}`),
            onSuccess: done,
        }),
        reorder: useMutation({
            mutationFn: async (ids: number[]) => http.put(`${BASE}/categories/order`, { categories: ids }),
            onSuccess: done,
        }),
        membership: useMutation({
            mutationFn: async ({ id, uuid, member }: { id: number; uuid: string; member: boolean }) =>
                http.put(`${BASE}/categories/${id}/servers/${uuid}`, { member }),
            onSuccess: done,
        }),
    };
}
