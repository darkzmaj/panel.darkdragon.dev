import React, { useCallback, useRef, useState } from 'react';
import { useStoreState } from 'easy-peasy';
import { Bell } from 'lucide-react';
import { ApplicationStore } from '@/state';
import Popover from '@/components/elements/Popover';

// Shows real Panel events only (the server provides them in the site settings, for example an available update for
// administrators). There is deliberately nothing here when nothing has happened.
const NotificationBell = () => {
    const items = useStoreState((state: ApplicationStore) => state.settings.data?.notifications) || [];
    const [open, setOpen] = useState(false);
    const toggle = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);

    return (
        <>
            <button
                ref={toggle}
                type={'button'}
                className={'gb-icon-btn'}
                style={{ position: 'relative', height: 44, width: 44 }}
                aria-label={items.length ? `Notifications (${items.length})` : 'Notifications'}
                aria-haspopup={'menu'}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <Bell aria-hidden />
                {items.length > 0 && (
                    <span
                        aria-hidden
                        style={{
                            position: 'absolute',
                            top: 9,
                            right: 10,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--gb-primary)',
                        }}
                    />
                )}
            </button>
            <Popover
                anchor={toggle.current}
                open={open}
                onClose={close}
                align={'end'}
                label={'Notifications'}
                className={'gb-menu'}
            >
                <div style={{ minWidth: 280, maxWidth: 340 }}>
                    <div className={'gb-eyebrow'} style={{ padding: '8px 10px' }}>
                        Notifications
                    </div>
                    {items.length === 0 ? (
                        <div className={'gb-secondary'} style={{ padding: '6px 10px 12px', fontSize: 13 }}>
                            You&apos;re all caught up.
                        </div>
                    ) : (
                        items.map((item) => (
                            <a
                                key={item.id}
                                role={'menuitem'}
                                href={item.href}
                                className={'gb-menu-item'}
                                style={{ height: 'auto', padding: '10px' }}
                            >
                                <span>
                                    <strong style={{ display: 'block', color: 'var(--gb-text-strong)' }}>
                                        {item.title}
                                    </strong>
                                    {item.description && <span className={'gb-secondary'}>{item.description}</span>}
                                </span>
                            </a>
                        ))
                    )}
                </div>
            </Popover>
        </>
    );
};

export default NotificationBell;
