import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreState } from 'easy-peasy';
import { ChevronDown, LogOut, Monitor, Moon, Palette, Settings, ShieldCheck, Sun } from 'lucide-react';
import { ApplicationStore } from '@/state';
import Avatar from '@/components/Avatar';
import Popover from '@/components/elements/Popover';
import useTheme from '@/plugins/useTheme';
import { ThemePreference } from '@/api/account/appearance';

interface Props {
    onLogout: () => void;
}

const themes: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'light', label: 'Light', icon: Sun },
];

// The profile menu in the top bar: Account, Appearance, Admin (administrators only) and Log out.
const UserMenu = ({ onLogout }: Props) => {
    const rootAdmin = useStoreState((state: ApplicationStore) => state.user.data!.rootAdmin);
    const username = useStoreState((state: ApplicationStore) => state.user.data!.username);
    const email = useStoreState((state: ApplicationStore) => state.user.data!.email);
    const [open, setOpen] = useState(false);
    const toggle = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);
    const { theme, setTheme } = useTheme();

    return (
        <>
            <button
                ref={toggle}
                type={'button'}
                className={'gb-user-btn'}
                aria-haspopup={'menu'}
                aria-expanded={open}
                aria-label={`Account menu for ${username}`}
                onClick={() => setOpen((v) => !v)}
            >
                <span className={'block w-[30px] h-[30px] rounded-full overflow-hidden flex-none'}>
                    <Avatar.User thumbnail size={30} />
                </span>
                <span className={'gb-user-name'}>{username}</span>
                <ChevronDown aria-hidden />
            </button>
            <Popover
                anchor={toggle.current}
                open={open}
                onClose={close}
                align={'end'}
                label={'Account'}
                className={'gb-menu'}
            >
                <div style={{ padding: '8px 10px 10px', minWidth: 240 }}>
                    <div style={{ fontWeight: 700, color: 'var(--gb-text-strong)' }}>{username}</div>
                    <div
                        className={'gb-secondary'}
                        style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                        {email}
                    </div>
                </div>
                <div className={'gb-menu-sep'} />
                <Link role={'menuitem'} to={'/account'} className={'gb-menu-item'} onClick={close}>
                    <Settings aria-hidden /> Account
                </Link>
                <Link role={'menuitem'} to={'/account/appearance'} className={'gb-menu-item'} onClick={close}>
                    <Palette aria-hidden /> Appearance
                </Link>
                {rootAdmin && (
                    <a role={'menuitem'} href={'/admin'} className={'gb-menu-item'}>
                        <ShieldCheck aria-hidden /> Admin
                    </a>
                )}
                <div className={'gb-menu-sep'} />
                <div role={'group'} aria-label={'Theme'} style={{ display: 'flex', gap: 4, padding: '2px 4px 6px' }}>
                    {themes.map(({ value, label, icon: Icon }) => (
                        <button
                            key={value}
                            type={'button'}
                            role={'menuitemradio'}
                            aria-checked={theme === value}
                            title={label}
                            onClick={() => setTheme(value)}
                            className={'gb-menu-item'}
                            style={{
                                justifyContent: 'center',
                                padding: 0,
                                flex: 1,
                                background: theme === value ? 'var(--gb-primary-soft)' : undefined,
                                color: theme === value ? 'var(--gb-primary)' : undefined,
                            }}
                        >
                            <Icon aria-hidden />
                            <span className={'sr-only'}>{label}</span>
                        </button>
                    ))}
                </div>
                <div className={'gb-menu-sep'} />
                <button
                    role={'menuitem'}
                    type={'button'}
                    className={'gb-menu-item'}
                    onClick={() => {
                        close();
                        onLogout();
                    }}
                >
                    <LogOut aria-hidden /> Log out
                </button>
            </Popover>
        </>
    );
};

export default UserMenu;
