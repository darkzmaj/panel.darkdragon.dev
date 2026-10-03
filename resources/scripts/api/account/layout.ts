import http from '@/api/http';

export interface LayoutServer {
    uuid: string;
    identifier: string;
    name: string;
    owned: boolean;
}

export interface LayoutCategory {
    id: number;
    name: string;
    servers: string[];
}

export interface ServerLayout {
    servers: LayoutServer[];
    order: string[];
    categories: LayoutCategory[];
}

export const getLayout = async (): Promise<ServerLayout> => (await http.get('/api/client/account/layout')).data;

export const saveOrder = async (servers: string[]): Promise<ServerLayout> =>
    (await http.put('/api/client/account/layout/order', { servers })).data;

export const saveCategoryOrder = async (id: number, servers: string[]): Promise<ServerLayout> =>
    (await http.put(`/api/client/account/layout/categories/${id}/order`, { servers })).data;

export const saveCategoryButtons = async (categories: number[]): Promise<ServerLayout> =>
    (await http.put('/api/client/account/layout/categories/order', { categories })).data;

export const createCategory = async (name: string, servers: string[]): Promise<ServerLayout> =>
    (await http.post('/api/client/account/layout/categories', { name, servers })).data;

export const updateCategory = async (id: number, name: string, servers: string[]): Promise<ServerLayout> =>
    (await http.put(`/api/client/account/layout/categories/${id}`, { name, servers })).data;

export const deleteCategory = (id: number): Promise<void> => http.delete(`/api/client/account/layout/categories/${id}`);
