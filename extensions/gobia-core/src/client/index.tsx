import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';
import ProfileSync from './ProfileSync';
import { initAppearance } from './appearance';
import { applyLogo } from './branding';

export default definePterodactylExtension({
    setup({ screens, slots, config }) {
        // Paint in the remembered scheme straight away; AppearanceSync reconciles it with the saved profile.
        initAppearance();
        applyLogo(String(config.logo ?? ''));
        slots.register('nav.items.after', ProfileSync);
        screens.register('profile', () => import('./screens/ProfileScreen'));
        screens.register('appearance', () => import('./screens/AppearanceScreen'));
    },
});
