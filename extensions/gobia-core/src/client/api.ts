import { http } from '@pterodactyl/sdk';
import type { Scheme } from './appearance';

const BASE = '/api/client/extensions/gobia-core';

export interface GobiaProfile {
    theme: Scheme;
}

export const profileQueryKey = ['gobia-core', 'profile'] as const;

export async function fetchProfile(): Promise<GobiaProfile> {
    return (await http.get<GobiaProfile>(`${BASE}/profile`)).data;
}

export async function saveAppearance(theme: Scheme): Promise<GobiaProfile> {
    return (await http.put<GobiaProfile>(`${BASE}/profile/appearance`, { theme })).data;
}
