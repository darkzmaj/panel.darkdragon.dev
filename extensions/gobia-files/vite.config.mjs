import { defineExtensionConfig } from '../../packages/sdk/vite.mjs';

const config = defineExtensionConfig({ entry: 'src/client/index.tsx' });

// Vite's preload helper resolves lazy chunk names against the document, not the extension bundle, so every shared chunk
// is first requested from the site root (served the SPA shell, wrong MIME type). The real imports are relative and fine.
config.build.modulePreload = false;

// The Monaco worker is emitted as a file next to the bundle and found relative to it.
config.base = './';
config.worker = { format: 'es' };

/**
 * Without the preload helper nothing links the stylesheets of a lazy chunk. The editor chunk (Monaco and its CSS) is
 * the only one, so it loads its own stylesheets before it runs; the entry never pays for them.
 */
config.plugins.push({
    name: 'gobia-lazy-chunk-styles',
    enforce: 'post',
    generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
            if (chunk.type !== 'chunk' || chunk.isEntry || !chunk.isDynamicEntry) continue;
            const styles = new Set();
            const visited = new Set();
            const collect = (file) => {
                if (visited.has(file)) return;
                visited.add(file);
                const dependency = bundle[file];
                if (dependency?.type !== 'chunk') return;
                for (const imported of dependency.imports) collect(imported);
                for (const style of dependency.viteMetadata?.importedCss ?? []) styles.add(style);
            };
            collect(chunk.fileName);
            if (!styles.size) continue;
            const prelude = `await Promise.all(${JSON.stringify([...styles])}.map(file => document.querySelector('link[data-gobia-lazy="' + file + '"]') ? null : new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.gobiaLazy = file;
    link.href = new URL(file, import.meta.url).href;
    link.onload = () => resolve();
    link.onerror = () => { link.remove(); reject(new Error('Unable to load stylesheet: ' + file)); };
    document.head.append(link);
})));\n`;
            chunk.code = prelude + chunk.code;
        }
    },
});

export default config;
