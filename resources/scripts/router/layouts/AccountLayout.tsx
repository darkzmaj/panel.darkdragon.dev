import { Outlet } from '@tanstack/react-router';
import {
    Activity,
    ChevronRight,
    KeyRound,
    Palette,
    ShieldCheck,
    Terminal,
    User,
    Users,
    type LucideIcon,
} from 'lucide-react';
import NavLink from '@/router/NavLink';
import { getAreaNav } from '@/router/nav';
import Slot from '@/extensions/Slot';
import NavigationLabel from '@/extensions/NavigationLabel';
import { ScreenGate } from '@/extensions/screenNavigation';

const icons: Record<string, LucideIcon> = {
    '': User,
    profile: User,
    security: ShieldCheck,
    access: Users,
    activity: Activity,
    api: KeyRound,
    ssh: Terminal,
    appearance: Palette,
};

// Gobia order of the account menu; the stock overview page (password, email, two step) is Security there.
const ORDER = ['profile', '', 'access', 'activity', 'api', 'ssh', 'appearance'];
const rank = (segment: string) => {
    const index = ORDER.indexOf(segment);

    return index === -1 ? ORDER.length : index;
};

/** Account pages: a local menu on the left, the page's cards on the right (the Gobia settings pattern). */
export default function AccountLayout() {
    return (
        <div className={'gb-split'}>
            <nav className={'gb-subnav'} aria-label={'Account'}>
                <Slot name={'account.navigation.before'} />
                {[...getAreaNav('account')]
                    .sort((a, b) => rank(a.segment) - rank(b.segment))
                    .map(({ segment, label, exact = false, ...meta }) => {
                        const Icon = icons[segment] ?? User;

                        return (
                            <ScreenGate key={segment || '/'} screen={meta.screen}>
                                <NavLink to={`/account${segment ? `/${segment}` : ''}`} exact={exact}>
                                    <Icon aria-hidden />
                                    <span>
                                        <NavigationLabel
                                            label={segment === '' ? 'Security' : label}
                                            {...meta}
                                            icon={undefined}
                                        />
                                    </span>
                                    <ChevronRight aria-hidden className={'gb-chevron'} />
                                </NavLink>
                            </ScreenGate>
                        );
                    })}
                <Slot name={'account.navigation.after'} />
            </nav>
            <div className={'gb-split-content'}>
                <Outlet />
            </div>
        </div>
    );
}
