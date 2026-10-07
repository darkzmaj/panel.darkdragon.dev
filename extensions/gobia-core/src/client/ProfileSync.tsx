import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyScheme, storeScheme } from './appearance';
import { applyAvatar } from './branding';
import { fetchProfile, profileQueryKey, saveAppearance } from './api';

/** Headless: loads the signed in user's saved scheme and avatar and applies them. Rendered in the authenticated navigation. */
export default function ProfileSync() {
    const { data } = useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile, staleTime: Infinity });
    const queryClient = useQueryClient();
    const theme = data?.theme;
    const avatar = data?.avatar_url ?? null;

    useEffect(() => {
        if (theme) {
            storeScheme(theme);
            applyScheme(theme);
        }
    }, [theme]);

    useEffect(() => {
        if (data) applyAvatar(avatar);
    }, [data, avatar]);

    return null;
}
