import React, { createContext, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

interface ShellState {
    drawerOpen: boolean;
    setDrawerOpen: (open: boolean) => void;
    sidebarEl: HTMLElement | null;
    setSidebarEl: (el: HTMLElement | null) => void;
}

const ShellContext = createContext<ShellState>({
    drawerOpen: false,
    setDrawerOpen: () => undefined,
    sidebarEl: null,
    setSidebarEl: () => undefined,
});

export function ShellProvider({ children }: { children: React.ReactNode }) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [sidebarEl, setSidebarEl] = useState<HTMLElement | null>(null);
    const value = useMemo(() => ({ drawerOpen, setDrawerOpen, sidebarEl, setSidebarEl }), [drawerOpen, sidebarEl]);

    return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export const useShell = () => useContext(ShellContext);

/** Renders its children inside the shell's sidebar, so every area (dashboard, server, admin) supplies its own navigation. */
export function SidebarContent({ children }: { children: React.ReactNode }) {
    const { sidebarEl } = useShell();

    return sidebarEl ? createPortal(children, sidebarEl) : null;
}
