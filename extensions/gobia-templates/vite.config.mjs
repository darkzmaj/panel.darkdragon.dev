import { defineExtensionConfig } from '../../packages/sdk/vite.mjs';

const config = defineExtensionConfig({ entry: 'src/client/index.tsx' });

// Vite's preload helper resolves lazy chunk names against the document, not the extension bundle, so every shared chunk
// is first requested from the site root (served the SPA shell, wrong MIME type). The real imports are relative and fine.
config.build.modulePreload = false;

export default config;
