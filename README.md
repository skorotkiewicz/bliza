# bliza.

A Polish community for questions and 160-character blips, inspired by Zapytaj and Blip.
Built with SvelteKit, Bun and openrails. All data and uploaded images live in OpenRails.

## Run locally

```sh
bun install
cp -n .env.example .env
# Fill in the OpenRails URL and project API key.
bun --env-file=.env run dev
```

Restart the server after changing `.env`. Keep secrets server-side, never in `PUBLIC_` variables.

## Configuration

| Variable              | Purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `OPENRAILS_URL`       | OpenRails backend URL                                                               |
| `OPENRAILS_TOKEN`     | Project API key                                                                     |
| `OPENRAILS_NAMESPACE` | Storage namespace, default `bliza`                                                  |
| `ADMIN`               | Separate admin secret; empty or invalid disables `/admin`                           |
| `REQUIRE_APPROVAL`    | `true` by default; `false` allows posts and replies without approval                |
| `SEED_DEMO`           | `true` adds fictional content when initializing an empty namespace; default `false` |
| `ORIGIN`              | Public HTTPS URL for production                                                     |

Generate `ADMIN` with `openssl rand -hex 32`. It must contain 32–256 printable ASCII characters without spaces.

## Accounts and moderation

- Start without registration. Save a TXT return ticket from your profile to recover the account in another browser.
- Treat the ticket like a password. Losing both the ticket and browser session means losing access.
- Replacing a ticket invalidates the previous file and logs out other devices. Profiles also support individual device logout.
- When approval is required, send a profile request and confirm its code with the moderator. No email or identity documents are needed.
- `/admin` handles approvals, reports, hidden content, bans and an audit log. Approval is community consent, not legal-identity verification.
- File cleanup requires confirmation and removes unreferenced backend files across the OpenRails project, not posts or referenced images.

Add a photo by choosing a file, pasting or dropping it into the blip textarea, or entering a public HTTPS image link. Blips accept JPG, PNG, GIF or WebP images up to 5 MB. Uploads are resized, stripped of metadata and stored as WebP.

Post links use `/pytanie/<id>/<slug>` or `/wpis/<id>/<slug>`. Profiles use `/ludzie/<nick>` and pagination adds `/strona/2`.

## Production

Set `ORIGIN` to the public HTTPS URL in `.env`, then:

```sh
bun --env-file=.env run build
bun --env-file=.env run start
```

Use an HTTPS reverse proxy, and HTTPS for the backend outside a trusted LAN.
Allow requests of at least 6 MB for the portal and 8 MB for the backend.
`/healthz` returns 200 when storage is ready, otherwise 503. Back up the backend database and file directory together.
For multiple app instances, use the same OpenRails project, namespace and configuration.

## Checks

```sh
OPENRAILS_BACKEND_BIN=/path/to/openrails-backend bun run test:release
```

This runs storage, build and browser checks against a temporary local backend, without touching portal data.
Browser checks need Chromium; set `CHROMIUM_PATH` if necessary.
`bun run test` and `bun run test:ui` instead use test namespaces on the configured backend.
Rebuild for production after browser checks.

Mountain photo from Unsplash. Not affiliated with Zapytaj or Blip.
