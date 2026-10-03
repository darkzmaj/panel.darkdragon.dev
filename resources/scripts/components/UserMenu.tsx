import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import Avatar from '@/components/Avatar';

interface Props {
    onLogout: () => void;
}

// Avatar button with the account dropdown: Account, Admin (administrators only) and Logout.
const UserMenu = ({ onLogout }: Props) => {
    const rootAdmin = useStoreState((state: ApplicationStore) => state.user.data!.rootAdmin);
    const username = useStoreState((state: ApplicationStore) => state.user.data!.username);
    const [open, setOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);

    const close = useCallback((refocus = false) => {
        setOpen(false);
        if (refocus) toggle.current?.focus();
    }, []);

    useEffect(() => {
        if (!open) return;

        const onPointer = (e: MouseEvent) => {
            if (container.current && !container.current.contains(e.target as Node)) close();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                close(true);
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const items = Array.from(container.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
                const index = items.indexOf(document.activeElement as HTMLElement);
                const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
                items[(next + items.length) % items.length]?.focus();
            }
        };

        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        container.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const item =
        'block w-full text-left px-4 py-2 text-sm text-neutral-300 no-underline hover:bg-neutral-700 hover:text-neutral-100 focus:bg-neutral-700 focus:text-neutral-100 focus:outline-none';

    return (
        <div ref={container} className={'relative h-full flex items-center px-4'}>
            <button
                ref={toggle}
                type={'button'}
                aria-haspopup={'menu'}
                aria-expanded={open}
                aria-label={`Account menu for ${username}`}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex items-center justify-center w-8 h-8 rounded-full overflow-hidden bg-neutral-600 ring-2 ring-transparent hover:ring-cyan-600 focus:ring-cyan-600 focus:outline-none transition-shadow duration-150'
                }
            >
                <Avatar.User thumbnail size={32} />
            </button>
            {open && (
                <div
                    role={'menu'}
                    aria-label={'Account'}
                    className={
                        'absolute right-2 top-full mt-1 w-44 py-1 rounded bg-neutral-800 border border-neutral-700 shadow-lg z-50'
                    }
                >
                    <Link role={'menuitem'} to={'/account'} className={item} onClick={() => close()}>
                        Account
                    </Link>
                    {rootAdmin && (
                        <a role={'menuitem'} href={'/admin'} className={item}>
                            Admin
                        </a>
                    )}
                    <button
                        role={'menuitem'}
                        type={'button'}
                        className={item}
                        onClick={() => {
                            close();
                            onLogout();
                        }}
                    >
                        Logout
                    </button>
                </div>
            )}
        </div>
    );
};

export default UserMenu;
