export type View = 'all' | 'you' | 'other';

export interface Instance {
    uuid: string;
    identifier: string;
    name: string;
    description: string | null;
    address: string | null;
    is_owner: boolean;
    status: string | null;
    limits: { memory: number; disk: number; cpu: number };
    icon_color: string | null;
    categories: number[];
}

export interface Pagination {
    total: number;
    count: number;
    per_page: number;
    current_page: number;
    total_pages: number;
}

export interface InstancePage {
    data: Instance[];
    meta: { pagination: Pagination };
}

export interface Category {
    id: number;
    name: string;
    position: number;
    count: number;
}

export interface Summary {
    categories: Category[];
    uncategorized: number;
    counts: { all: number; you: number; other: number };
    recent_icon_colors: string[];
}

/** A category id, `none` for servers in no category, or null for every server. */
export type CategoryFilter = number | 'none' | null;

export interface ListParams {
    view: View;
    category: CategoryFilter;
    q: string;
    page: number;
}
