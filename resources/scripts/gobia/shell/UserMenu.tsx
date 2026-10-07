import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, LogOut, Monitor, Moon, Palette, Settings, ShieldCheck, Sun } from 'lucide-react';
import { useCurrentUser } from '@/api/account/queries';
import Avatar from '@/components/Avatar';
import { useBranding } from '@/gobia/branding';
import { currentScheme, requestScheme, type SchemeChoice } from '@/gobia/scheme';

const schemes: Array<{ value: SchemeChoice; label: string; icon: typeof Sun }> = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'light', label: 'Light', icon: Sun },
];

/** The profile menu in the top bar: Account, Appearance, Admin (administrators only), theme and Log out. */
export default function UserMenu({ onLogout }: { onLogout: () => void }) {
    const user = useCurrentUser();
    const avatar = useBranding('avatar');
    const [open, setOpen] = useState(false);
    const [scheme, setScheme] = useState<SchemeChoice>(currentScheme);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const away = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
        const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', key);

        return () => {
            document.removeEventListener('mousedown', away);
            document.removeEventListener('keydown', key);
        };
    }, [open]);

    return (
        <div ref={root} style={{ position: 'relative' }}>
            <button
                type={'button'}
                className={'gb-user-btn'}
                aria-haspopup={'menu'}
                aria-expanded={open}
                aria-label={`Account menu for ${user.username}`}
                onClick={() => setOpen((value) => !value)}
            >
                <span className={'block w-[30px] h-[30px] rounded-full overflow-hidden flex-none'}>
                    {avatar ? (
                        <img src={avatar} alt={''} style={{ width: 30, height: 30 }} />
                    ) : (
                        <Avatar.User size={30} />
                    )}
                </span>
                <span className={'gb-user-name'}>{user.username}</span>
                <ChevronDown aria-hidden />
            </button>
            {open && (
                <div
                    role={'menu'}
                    aria-label={'Account'}
                    className={'gb-menu'}
                    style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)' }}
                >
                    <div style={{ padding: '8px 10px 10px', minWidth: 240 }}>
                        <div style={{ fontWeight: 700, color: 'var(--gb-text-strong)' }}>{user.username}</div>
                        <div
                            className={'gb-secondary'}
                            style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                            {user.email}
                        </div>
                    </div>
                    <div className={'gb-menu-sep'} />
                    <Link role={'menuitem'} to={'/account'} className={'gb-menu-item'} onClick={() => setOpen(false)}>
                        <Settings aria-hidden /> Account
                    </Link>
                    <Link
                        role={'menuitem'}
                        to={'/account/appearance' as never}
                        className={'gb-menu-item'}
                        onClick={() => setOpen(false)}
                    >
                        <Palette aria-hidden /> Appearance
                    </Link>
                    {user.rootAdmin && (
                        <Link role={'menuitem'} to={'/panel'} className={'gb-menu-item'} onClick={() => setOpen(false)}>
                            <ShieldCheck aria-hidden /> Admin
                        </Link>
                    )}
                    <div className={'gb-menu-sep'} />
                    <div
                        role={'group'}
                        aria-label={'Theme'}
                        style={{ display: 'flex', gap: 4, padding: '2px 4px 6px' }}
                    >
                        {schemes.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type={'button'}
                                role={'menuitemradio'}
                                aria-checked={scheme === value}
                                title={label}
                                onClick={() => {
                                    setScheme(value);
                                    requestScheme(value);
                                }}
                                className={'gb-menu-item'}
                                style={{
                                    justifyContent: 'center',
                                    padding: 0,
                                    flex: 1,
                                    background: scheme === value ? 'var(--gb-primary-soft)' : undefined,
                                    color: scheme === value ? 'var(--gb-primary)' : undefined,
                                }}
                            >
                                <Icon aria-hidden />
                            </button>
                        ))}
                    </div>
                    <div className={'gb-menu-sep'} />
                    <button type={'button'} role={'menuitem'} className={'gb-menu-item'} onClick={onLogout}>
                        <LogOut aria-hidden /> Log out
                    </button>
                </div>
            )}
        </div>
    );
}
