import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';
import AppearanceSync from './AppearanceSync';
import { initAppearance } from './appearance';

export default definePterodactylExtension({
    setup({ screens, slots }) {
        // Paint in the remembered scheme straight away; AppearanceSync reconciles it with the saved profile.
        initAppearance();
        slots.register('nav.items.after', AppearanceSync);
        screens.register('appearance', () => import('./screens/AppearanceScreen'));
    },
});
