import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import Avatar from '@/components/Avatar';
import Popover from '@/components/elements/Popover';

interface Props {
    onLogout: () => void;
}

const item =
    'block w-full text-left px-4 py-2 text-sm text-neutral-300 no-underline hover:bg-neutral-700 hover:text-neutral-100 focus:bg-neutral-700 focus:text-neutral-100 focus:outline-none';

// Avatar button with the account menu: Account, Admin (administrators only) and Logout.
const UserMenu = ({ onLogout }: Props) => {
    const rootAdmin = useStoreState((state: ApplicationStore) => state.user.data!.rootAdmin);
    const username = useStoreState((state: ApplicationStore) => state.user.data!.username);
    const [open, setOpen] = useState(false);
    const toggle = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);

    return (
        <div className={'h-full flex items-center px-4'}>
            <button
                ref={toggle}
                type={'button'}
                aria-haspopup={'menu'}
                aria-expanded={open}
                aria-label={`Account menu for ${username}`}
                onClick={() => setOpen((v) => !v)}
                className={
                    'flex items-center justify-center w-8 h-8 rounded-full overflow-hidden bg-neutral-600 ring-2 ring-transparent hover:ring-cyan-600 focus:ring-cyan-600 focus:outline-none'
                }
            >
                <Avatar.User thumbnail size={32} />
            </button>
            <Popover
                anchor={toggle.current}
                open={open}
                onClose={close}
                align={'end'}
                label={'Account'}
                className={'w-44 py-1 rounded bg-neutral-800 border border-neutral-700 shadow-lg'}
            >
                <Link role={'menuitem'} to={'/account'} className={item} onClick={close}>
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
            </Popover>
        </div>
    );
};

export default UserMenu;
