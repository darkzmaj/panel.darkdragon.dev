import { useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';

const subscribe = (listener: () => void) => {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
};

const currentTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

/** Bottom-right notifications in the Gobia colours: solid green for success, red for errors, the surface tone for info. */
const AppToaster = () => {
    const theme = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as const);

    return (
        <Toaster
            closeButton
            theme={theme}
            position={'bottom-right'}
            visibleToasts={4}
            toastOptions={{
                unstyled: true,
                classNames: {
                    toast: 'relative flex w-full items-center gap-3 rounded-md border border-transparent bg-secondary py-2.5 pr-11 pl-4 text-secondary-foreground shadow-lg',
                    title: 'text-sm font-medium leading-tight tracking-normal',
                    description: 'mt-1 text-sm leading-snug tracking-normal opacity-80',
                    closeButton:
                        'absolute! top-1/2! right-2! left-auto! flex! h-7! w-7! -translate-y-1/2! items-center justify-center rounded-md! border! border-transparent! bg-transparent! text-current! opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>svg]:h-4 [&>svg]:w-4',
                    actionButton:
                        'ml-auto inline-flex h-7 shrink-0 items-center rounded-md bg-foreground/15 px-3 text-xs font-semibold transition-colors hover:bg-foreground/25',
                    icon: 'hidden',
                    error: 'bg-destructive! text-destructive-foreground!',
                    success: 'bg-success! text-success-foreground!',
                    warning: 'bg-caution! text-caution-foreground!',
                    info: 'bg-secondary! text-secondary-foreground!',
                },
            }}
        />
    );
};

export default AppToaster;
