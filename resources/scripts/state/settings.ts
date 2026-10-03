import { action, Action } from 'easy-peasy';

export interface FooterLink {
    label: string;
    href: string | null;
    soon: boolean;
}

export interface SiteSettings {
    name: string;
    locale: string;
    logo: string | null;
    recaptcha: {
        enabled: boolean;
        siteKey: string;
    };
    footer?: {
        // eslint-disable-next-line camelcase
        tagline_strong: string;
        tagline: string;
        // eslint-disable-next-line camelcase
        discord_url: string | null;
        columns: Array<{ title: string; links: FooterLink[] }>;
    };
    // Real events for the notification bell (for example an available Panel update, shown to administrators).
    notifications?: Array<{ id: string; title: string; description?: string; href: string }>;
}

export interface SettingsStore {
    data?: SiteSettings;
    setSettings: Action<SettingsStore, SiteSettings>;
}

const settings: SettingsStore = {
    data: undefined,

    setSettings: action((state, payload) => {
        state.data = payload;
    }),
};

export default settings;
