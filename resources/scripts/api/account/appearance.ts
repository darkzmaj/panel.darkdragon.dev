import http from '@/api/http';

export type ThemePreference = 'system' | 'dark' | 'light';

export default async (theme: ThemePreference): Promise<ThemePreference> => {
    const { data } = await http.put('/api/client/account/appearance', { theme });

    return data.theme;
};
