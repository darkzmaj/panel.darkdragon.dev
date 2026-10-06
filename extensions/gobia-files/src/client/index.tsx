import './styles.css';
import { definePterodactylExtension } from '@pterodactyl/sdk';

export default definePterodactylExtension({
    setup({ components }) {
        // The workspace (and with it CodeMirror) loads only when a server's file page opens.
        components.replace('server.files.manager', { load: () => import('./workspace/Workspace') });
    },
});
