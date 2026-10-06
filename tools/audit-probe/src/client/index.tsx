import './styles.css';
import { definePterodactylExtension, type ReplacementProps } from '@pterodactyl/sdk';

function Boom(): never {
    throw new Error('audit-probe intentional slot failure');
}

function Card({ Default }: ReplacementProps<'dashboard.serverCard'>) {
    return <Default className="ap:ring-1" />;
}

export default definePterodactylExtension({
    setup({ screens, slots, components }) {
        screens.register('main', () => import('./screens/ServerScreen'));
        screens.register('account', () => import('./screens/Generic'));
        screens.register('admin', () => import('./screens/Generic'));
        screens.register('usertab', () => import('./screens/Generic'));
        slots.register('dashboard.serverRow.name.after', () => <span data-probe="row-name">ap</span>);
        slots.register('server.console.after', () => <div data-probe="console-after">ap-console</div>);
        slots.register('dashboard.after', Boom);
        components.replace('dashboard.serverCard', Card);
    },
});
