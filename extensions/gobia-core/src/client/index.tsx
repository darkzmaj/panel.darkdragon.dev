import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';
import AppearanceSync from './AppearanceSync';
import { initAppearance } from './appearance';
import { applyLogo } from './branding';

export default definePterodactylExtension({
    setup({ screens, slots, config }) {
        // Paint in the remembered scheme straight away; AppearanceSync reconciles it with the saved profile.
        initAppearance();
        applyLogo(String(config.logo ?? ''));
        slots.register('nav.items.after', AppearanceSync);
        screens.register('appearance', () => import('./screens/AppearanceScreen'));
    },
});
