import { Settings } from 'lucide-react';

// The gobia.cloud footer. Link targets are paths on the Gobia site; "soon" shows the SOON badge instead of a link.
const SITE = 'https://gobia.cloud';

interface FooterLink {
    label: string;
    href?: string;
    soon?: boolean;
}

const columns: Array<{ title: string; links: FooterLink[] }> = [
    {
        title: 'PRODUCT',
        links: [
            { label: 'Cloud', href: '/cloud' },
            { label: 'Tools', href: '/tools' },
            { label: 'Pricing', href: '/pricing' },
            { label: 'Hosting Roadmap', href: '/roadmap' },
        ],
    },
    {
        title: 'COMPANY',
        links: [
            { label: 'About Us', href: '/about' },
            { label: 'Contact', href: '/contact' },
            { label: 'Careers', soon: true },
        ],
    },
    {
        title: 'LEGAL',
        links: [
            { label: 'Privacy Policy', href: '/privacy' },
            { label: 'Terms of Service', href: '/terms' },
            { label: 'Cookie Policy', href: '/cookies' },
            { label: 'DMCA', href: '/dmca' },
            { label: 'Impressum', href: '/impressum' },
        ],
    },
];

export default function GobiaFooter() {
    return (
        <footer className={'gb-footer'}>
            <div className={'gb-footer-inner'}>
                <div className={'gb-footer-grid'}>
                    <div className={'gb-footer-brand'}>
                        <img
                            src={'/assets/theme/img/logo-text-240.png'}
                            srcSet={'/assets/theme/img/logo-text-240.png 1x, /assets/theme/img/logo-text-480.png 2x'}
                            alt={'Gobia Cloud'}
                            width={177}
                            height={56}
                        />
                        <p>
                            <strong>Beyond The Clouds</strong>
                            {
                                ', a secure digital home for your files, projects, and ideas, with reliable storage, easy access, and built-in peace of mind.'
                            }
                        </p>
                    </div>
                    {columns.map((column) => (
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
                                            <a href={SITE + link.href}>{link.label}</a>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </nav>
                    ))}
                </div>
                <div className={'gb-footer-bottom'}>
                    <div className={'gb-footer-center'}>
                        <p>
                            &copy; {new Date().getFullYear()} <strong>Gobia Cloud</strong>. All Rights Reserved.
                        </p>
                        <a
                            className={'gb-footer-cryvex'}
                            href={'https://cryvex.org'}
                            target={'_blank'}
                            rel={'noopener noreferrer'}
                            aria-label={'Cryvex, opens cryvex.org'}
                        >
                            <img
                                className={'gb-footer-watermark gb-only-dark'}
                                src={'/assets/theme/img/cryvex-240.png'}
                                alt={''}
                                width={110}
                                height={56}
                            />
                            <img
                                className={'gb-footer-watermark gb-only-light'}
                                src={'/assets/theme/img/cryvex-black-240.png'}
                                alt={''}
                                width={110}
                                height={56}
                            />
                        </a>
                    </div>
                    <div className={'gb-footer-tools'}>
                        <a
                            href={'https://gobia.cloud/discord'}
                            target={'_blank'}
                            rel={'noopener noreferrer'}
                            aria-label={'Join the Gobia Cloud Discord'}
                        >
                            <span className={'gb-footer-discord'} aria-hidden />
                        </a>
                        <a href={'/account/appearance'} aria-label={'Appearance settings'}>
                            <Settings aria-hidden />
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    );
}
