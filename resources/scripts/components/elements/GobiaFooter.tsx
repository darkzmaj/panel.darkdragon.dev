import React from 'react';
import { useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';

// A replica of the gobia.cloud footer (same markup and classes as resources/views/partials/gobia/footer.blade.php).
// Link targets come from config/gobia_ui.php through the site settings.
const GobiaFooter = () => {
    const footer = useStoreState((state: ApplicationStore) => state.settings.data?.footer);
    if (!footer) return null;

    return (
        <footer className={'gb-footer'}>
            <div className={'gb-footer-inner'}>
                <div className={'gb-footer-grid'}>
                    <div className={'gb-footer-brand'}>
                        <img
                            src={'/themes/gobia/img/logo-text-240.png'}
                            srcSet={'/themes/gobia/img/logo-text-240.png 1x, /themes/gobia/img/logo-text-480.png 2x'}
                            alt={'Gobia Cloud'}
                            width={177}
                            height={56}
                        />
                        <p>
                            <strong>{footer.tagline_strong}</strong>
                            {footer.tagline}
                        </p>
                    </div>
                    {footer.columns.map((column) => (
                        <nav key={column.title} aria-label={column.title.toLowerCase()}>
                            <h4>{column.title}</h4>
                            <ul>
                                {column.links.map((link) => (
                                    <li key={link.label}>
                                        {link.soon || !link.href ? (
                                            <>
                                                <span className={'gb-footer-soon-label'}>{link.label}</span>{' '}
                                                <span className={'gb-soon'}>SOON</span>
                                            </>
                                        ) : (
                                            <a href={link.href}>{link.label}</a>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                </div>
                <div className={'gb-footer-bottom'}>
                    <div>
                        <p>
                            &copy; {new Date().getFullYear()} <strong>Gobia Cloud</strong>. All Rights Reserved.
                        </p>
                        <img
                            className={'gb-footer-watermark gb-only-dark'}
                            src={'/themes/gobia/img/cryvex-240.png'}
                            alt={'Official Cryvex Brand'}
                            width={110}
                            height={56}
                        />
                        <img
                            className={'gb-footer-watermark gb-only-light'}
                            src={'/themes/gobia/img/cryvex-black-240.png'}
                            alt={'Official Cryvex Brand'}
                            width={110}
                            height={56}
                        />
                    </div>
                    <div className={'gb-footer-tools'}>
                        {footer.discord_url && (
                            <a
                                href={footer.discord_url}
                                aria-label={'Discord'}
                                rel={'noopener noreferrer'}
                                target={'_blank'}
                            >
                                <img src={'/themes/gobia/img/discord.svg'} alt={''} />
                            </a>
                        )}
                        <a href={'/account/appearance'} aria-label={'Appearance settings'}>
                            <i className={'fa fa-cog'} />
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default GobiaFooter;
