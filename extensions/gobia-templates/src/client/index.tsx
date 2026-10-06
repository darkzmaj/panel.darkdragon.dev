import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';

export default definePterodactylExtension({
    setup({ screens }) {
        screens.register('templates', () => import('./screens/TemplatesScreen'));
        screens.register('editor', () => import('./screens/TemplateEditorScreen'));
    },
});
