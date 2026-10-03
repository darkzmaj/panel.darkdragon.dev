import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface Header {
    title: string;
    subtitle?: string;
}

interface ShellState {
    header: Header;
    setHeader: (header: Header) => void;
    drawerOpen: boolean;
    setDrawerOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState>({
    header: { title: '' },
    setHeader: () => undefined,
    drawerOpen: false,
    setDrawerOpen: () => undefined,
});

export const ShellProvider: React.FC<{ initial: Header }> = ({ initial, children }) => {
    const [header, setHeader] = useState<Header>(initial);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const value = useMemo(() => ({ header, setHeader, drawerOpen, setDrawerOpen }), [header, drawerOpen]);

    return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
};

export const useShell = () => useContext(ShellContext);

/** Sets the title and subtitle shown in the top bar while the calling page is mounted. */
export const useTopbarTitle = (title: string, subtitle?: string) => {
    const { setHeader } = useShell();
    useEffect(() => {
        setHeader({ title, subtitle });
    }, [title, subtitle]);
};
