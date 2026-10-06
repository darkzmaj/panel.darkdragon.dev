import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyScheme, storeScheme } from './appearance';
import { fetchProfile, profileQueryKey } from './api';

/** Headless: loads the signed in user's saved scheme once and applies it. Rendered in the authenticated navigation. */
export default function AppearanceSync() {
    const { data } = useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile, staleTime: Infinity });
    const theme = data?.theme;

    useEffect(() => {
        if (theme) {
            storeScheme(theme);
            applyScheme(theme);
        }
    }, [theme]);

    return null;
}
