import { Link } from '@tanstack/react-router';
import { useSiteSettings } from '@/api/settings/queries';
import { DEFAULT_LOGO, DEFAULT_LOGO_2X, useBranding } from '@/gobia/branding';

/** The wordmark in the top bar. An admin uploaded logo replaces the default; clearing it restores the Gobia default. */
export default function Brand() {
    const name = useSiteSettings().name;
    const logo = useBranding('logo');

    return (
        <Link to={'/'} className={'gb-topbar-brand'} aria-label={name}>
            <img
                src={logo || DEFAULT_LOGO}
                srcSet={logo ? undefined : `${DEFAULT_LOGO} 1x, ${DEFAULT_LOGO_2X} 2x`}
                alt={name}
                height={30}
            />
        </Link>
    );
}
