import { useCallback } from 'react';
import { useStoreActions, useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import updateAppearance, { ThemePreference } from '@/api/account/appearance';

declare global {
    interface Window {
        __gobiaSetTheme?: (theme: ThemePreference) => void;
    }
}

/**
 * The interface theme preference. Switching applies at once (the inline script in the page head owns the
 * data-theme attribute) and is saved to the account in the background so it follows the user between devices.
 */
export default () => {
    const theme = useStoreState((state: ApplicationStore) => state.user.data?.theme || 'system') as ThemePreference;
    const updateUserData = useStoreActions((actions: any) => actions.user.updateUserData);

    const setTheme = useCallback(
        (next: ThemePreference) => {
            window.__gobiaSetTheme?.(next);
            updateUserData({ theme: next });

            return updateAppearance(next).catch(() => undefined);
        },
        [updateUserData]
    );

    return { theme, setTheme };
};
