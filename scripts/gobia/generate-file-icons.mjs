// Builds the explorer's file icons from the Material Icon Theme (MIT, https://github.com/material-extensions/vscode-material-icon-theme).
//   node scripts/gobia/generate-file-icons.mjs
// Only the icons for the extensions, file names and folder names listed below are bundled (as data URIs inside the lazy
// file workspace chunk), never the whole theme. The mapping from a name to an icon comes from the theme's own manifest.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const theme = join(root, 'node_modules/material-icon-theme');
const manifest = JSON.parse(readFileSync(join(theme, 'dist/material-icons.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(theme, 'package.json'), 'utf8')).version;

const EXTENSIONS =
    `json jsonc json5 rs py pyc java js mjs cjs jsx ts mts cts tsx html htm xhtml css scss sass less php go cpp cc cxx hpp hh c h cs rb swift kt kts dart lua r pl scala groovy gradle sh bash zsh fish ps1 bat cmd sql yml yaml toml xml xsd svg md markdown mdx vue svelte astro properties ini cfg conf config env lock log txt csv tsv diff patch
png jpg jpeg gif webp bmp ico avif tiff psd mp4 mkv webm mov avi flv mp3 wav ogg flac aac m4a pdf doc docx xls xlsx ppt pptx
zip tar gz tgz bz2 xz rar 7z jar war ear zst lz4 iso dockerfile dat nbt mca mcmeta mcfunction schematic litematic
sh jsp ftl vsh fsh glsl wasm exe dll so bin class o a lib key pem crt cer pub gpg sig sqlite sqlite3 db sqlf rst tex ipynb http graphql gql proto tf hcl nix zig v vb asm s ex exs erl hs clj elm ml fs nim jl kts`.split(
        /\s+/
    );

const FILE_NAMES =
    `Dockerfile docker-compose.yml docker-compose.yaml compose.yml Makefile CMakeLists.txt .gitignore .gitattributes .gitmodules .gitkeep .dockerignore .editorconfig .env .env.local .env.example .env.production .eslintrc .eslintrc.json .prettierrc .npmrc .nvmrc package.json package-lock.json yarn.lock pnpm-lock.yaml bun.lockb composer.json composer.lock Cargo.toml Cargo.lock go.mod go.sum pom.xml build.gradle build.gradle.kts settings.gradle settings.gradle.kts gradle.properties gradlew requirements.txt Pipfile pyproject.toml setup.py tsconfig.json vite.config.ts vite.config.js webpack.config.js tailwind.config.js README.md readme.md LICENSE license CHANGELOG.md CONTRIBUTING.md CODEOWNERS robots.txt favicon.ico
server.properties bukkit.yml spigot.yml paper.yml paper-global.yml config.yml plugin.yml bungee.yml velocity.toml eula.txt ops.json whitelist.json banned-players.json banned-ips.json usercache.json fabric.mod.json mods.toml pack.mcmeta level.dat start.sh run.sh start.bat run.bat`.split(
        /\s+/
    );

const FOLDER_NAMES =
    `config configs conf plugins plugin mods src source sources assets resources res scripts script tests test spec specs logs log world worlds lib libs node_modules public static docs doc images img icons build dist out bin backups backup data cache temp tmp database db packages vendor app api components utils hooks styles css js ts java python rust go php html views controllers models routes middleware migrations seeds locale lang i18n themes datapacks resourcepacks saves crash-reports screenshots shaders versions libraries cache`.split(
        /\s+/
    );

const svgOf = (iconName) => {
    const definition = manifest.iconDefinitions[iconName];
    if (!definition) return null;
    const file = join(theme, 'dist', definition.iconPath);
    return readFileSync(file, 'utf8')
        .replace(/\s*\n\s*/g, '')
        .trim();
};

const icons = {}; // icon name -> data URI
const wanted = (iconName) => {
    if (!iconName) return null;
    if (icons[iconName] === undefined) {
        const svg = svgOf(iconName);
        if (!svg) return null;
        icons[iconName] = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }
    return iconName;
};

const lightOf = (table, key, dark) => {
    const light = manifest.light?.[table]?.[key];
    return light && light !== dark ? wanted(light) : null;
};

const byExtension = {};
const byLightExtension = {};
const byName = {};
const byLightName = {};
const missing = [];
for (const extension of new Set(EXTENSIONS)) {
    const name = wanted(manifest.fileExtensions[extension]);
    if (name) byExtension[extension] = name;
    else missing.push(`.${extension}`);
    const light = lightOf('fileExtensions', extension, name);
    if (light) byLightExtension[extension] = light;
}
for (const file of new Set(FILE_NAMES)) {
    const key = file.toLowerCase();
    const name = wanted(manifest.fileNames[file] ?? manifest.fileNames[key]);
    if (name) byName[key] = name;
    const light = lightOf('fileNames', key, name);
    if (light) byLightName[key] = light;
}
const byFolder = {};
const byFolderOpen = {};
for (const folder of new Set(FOLDER_NAMES)) {
    const name = wanted(manifest.folderNames[folder]);
    const open = wanted(manifest.folderNamesExpanded[folder]);
    if (name) byFolder[folder] = name;
    if (open) byFolderOpen[folder] = open;
}
const generic = {
    file: wanted(manifest.file),
    folder: wanted(manifest.folder),
    folderOpen: wanted(manifest.folderExpanded),
    root: wanted(manifest.rootFolder),
    rootOpen: wanted(manifest.rootFolderExpanded),
};

const map = (name, value) =>
    `export const ${name} = new Map<string, string>(${JSON.stringify(Object.entries(value))});`;
const out = `// Generated by scripts/gobia/generate-file-icons.mjs from Material Icon Theme ${version} (MIT). Do not edit.
// Icons: https://github.com/material-extensions/vscode-material-icon-theme, see docs/gobia-file-icons.md for the license.
${map('ICONS', icons)}
export const GENERIC = ${JSON.stringify(generic)} as const;
${map('BY_EXTENSION', byExtension)}
${map('BY_EXTENSION_LIGHT', byLightExtension)}
${map('BY_NAME', byName)}
${map('BY_NAME_LIGHT', byLightName)}
${map('BY_FOLDER', byFolder)}
${map('BY_FOLDER_OPEN', byFolderOpen)}
`;
writeFileSync(join(root, 'extensions/gobia-files/src/client/workspace/fileIcons.generated.ts'), out);
const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(
    `${Object.keys(icons).length} icons, ${kb} KB, ${Object.keys(byExtension).length} extensions, ${Object.keys(byName).length} file names, ${Object.keys(byFolder).length} folders`
);
if (missing.length) console.log(`no icon in the theme for: ${missing.join(' ')}`);
