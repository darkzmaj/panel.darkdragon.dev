import { http } from '@pterodactyl/sdk';
import type { Scheme } from './appearance';

const BASE = '/api/client/extensions/gobia-core';

export interface GobiaProfile {
    theme: Scheme;
    avatar_url: string | null;
    username: string;
}

export const profileQueryKey = ['gobia-core', 'profile'] as const;

export async function fetchProfile(): Promise<GobiaProfile> {
    return (await http.get<GobiaProfile>(`${BASE}/profile`)).data;
}

export async function saveAppearance(theme: Scheme): Promise<GobiaProfile> {
    return (await http.put<GobiaProfile>(`${BASE}/profile/appearance`, { theme })).data;
}

export async function uploadAvatar(png: Blob): Promise<GobiaProfile> {
    const body = new FormData();
    body.append('avatar', png, 'avatar.png');
    return (await http.post<GobiaProfile>(`${BASE}/profile/avatar`, body)).data;
}

export async function removeAvatar(): Promise<GobiaProfile> {
    return (await http.delete<GobiaProfile>(`${BASE}/profile/avatar`)).data;
}

export async function changeUsername(username: string, password: string): Promise<GobiaProfile> {
    return (await http.put<GobiaProfile>(`${BASE}/profile/username`, { username, password })).data;
}
