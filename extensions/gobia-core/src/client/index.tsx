import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';
import OverviewPanel from './admin/OverviewPanel';
import ProfileSync from './ProfileSync';
import { initAppearance } from './appearance';
import { applyLogo } from './branding';

export default definePterodactylExtension({
    setup({ screens, slots, components, config }) {
        // Paint in the remembered scheme straight away; AppearanceSync reconciles it with the saved profile.
        initAppearance();
        applyLogo(String(config.logo ?? ''));
        slots.register('nav.items.after', ProfileSync);
        slots.register('panel.overview.before', OverviewPanel);
        screens.register('profile', () => import('./screens/ProfileScreen'));
        components.replace('dashboard.page', { load: () => import('./dashboard/DashboardPage') });
        screens.register('access', () => import('./screens/AccessScreen'));
        screens.register('appearance', () => import('./screens/AppearanceScreen'));
    },
});
