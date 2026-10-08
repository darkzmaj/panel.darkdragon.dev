# Gobia file icons

The Files explorer, the editor tabs and the workspace search results use **Material Icon Theme** artwork, the same icon set many VS Code installations use.

| | |
| --- | --- |
| Source | https://github.com/material-extensions/vscode-material-icon-theme (npm `material-icon-theme`, pinned in `devDependencies`) |
| License | MIT, Copyright (c) Material Extensions. The full text ships in `node_modules/material-icon-theme/LICENSE`; the MIT notice and this attribution must stay with any redistribution of the generated file |
| Version used | see the header of `extensions/gobia-files/src/client/workspace/fileIcons.generated.ts` |
| Generator | `node scripts/gobia/generate-file-icons.mjs` |

## How it is bundled

The generator reads the theme's own manifest (`dist/material-icons.json`) and keeps only the icons for a curated list of file extensions, file names and folder names (about 200 icons, 170 extensions, 46 file names, 73 folder names). They are inlined as data URIs in the lazy file workspace chunk, so the Dashboard, Admin, Console and every other route never load them and the explorer makes no per icon requests. Extend the lists at the top of the generator and run it again to add a type.

Mapping rule (`FileTypeIcon.tsx`): exact file name first (`Dockerfile`, `package.json`, `server.properties`), then the last extension, then the theme's plain file icon. Folders use the theme's special folders (`config`, `plugins`, `src`, ...) with an open variant. Icons are decorative (`alt=""`); the row's text names the entry. Where the theme has a variant for light backgrounds it is used in the light scheme.

The earlier coloured abbreviation badges are gone.
