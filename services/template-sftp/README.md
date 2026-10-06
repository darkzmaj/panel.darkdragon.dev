# Template SFTP service

Node process that gives template editors SFTP access to one template's working files, jailed to that template.
It does not touch Wings. Credentials are checked by the Panel (`gobia-templates` extension).

Panel side (`.env`): `GOBIA_SFTP_SERVICE_TOKEN` (shared secret), optional `GOBIA_SFTP_HOST`, `GOBIA_SFTP_PORT` (shown to admins).

Service side environment:

| Variable | Meaning |
| --- | --- |
| `PANEL_URL` | Base URL of the Panel |
| `SFTP_SERVICE_TOKEN` | Same value as `GOBIA_SFTP_SERVICE_TOKEN` |
| `TEMPLATE_STORAGE` | Path of the Panel's template file store (the `gobia_templates.storage` directory) |
| `SFTP_PORT` / `SFTP_BIND` | Listen address, default `2223` / `0.0.0.0` |
| `SFTP_HOST_KEY` | Ed25519 host key path, generated if missing |

Internal endpoints used: `POST /extensions/gobia-templates/internal/sftp/{authenticate,session}`.

```
npm ci --omit=dev && node server.js
npm test
```
