import { defineConfig } from 'vitest/config';
import { pterodactylTestAliases, pterodactylTestSetup } from '../../packages/sdk/vitest.mjs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    resolve: {
        alias: pterodactylTestAliases(),
    },
    test: {
        name: 'gobia-files',
        environment: 'jsdom',
        setupFiles: [pterodactylTestSetup],
        include: ['src/**/*.spec.{ts,tsx}'],
        clearMocks: true,
        restoreMocks: true,
    },
});
