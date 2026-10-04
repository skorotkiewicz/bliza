# bliza.

A Polish Q&A portal mixed with 160-character microblogging, inspired by the old Zapytaj and Blip communities. Built with SvelteKit, Bun and the `openrails` SDK.

## Start

Set these variables in the **server environment** before starting:

```sh
export OPENRAILS_URL=http://192.168.0.124:8787
export OPENRAILS_TOKEN=your-project-api-key
export OPENRAILS_NAMESPACE=bliza
bun install
bun run dev
```

`.env.example` documents the settings without including a real key. The SDK reads these settings lazily; a key is not needed to build. Never expose the token with a `PUBLIC_` prefix or put it in client code. This HTTP endpoint is suitable for the trusted LAN only; use HTTPS outside it.

## Storage

Runtime storage uses OpenRails collections and its read-only SQL API for feeds and counts. Images go to OpenRails file storage and are streamed through `/media/…`, without exposing the service key or expiring download links. Each namespace uses its own collections and image directory. Empty namespaces receive the original fictional conversations once.

All portal data and uploaded images are stored on the configured OpenRails server.

## Checks and production

```sh
bun run test
bun run test:ui
bun run build
bun run start
```

Storage integration checks require `OPENRAILS_TOKEN`; image-validation checks run without it. Browser checks require the token and system Chromium (`CHROMIUM_PATH` can override `/usr/sbin/chromium`). Each check creates a unique remote test namespace, leaving test records and uploaded test images there, rather than modifying portal data. UI screenshots are saved in a temporary local directory.

Production builds default to `http://localhost:3000`. For deployment, set the public origin at build time: `ORIGIN=https://your-portal.example bun run build`, then `bun run start`. Rebuild normally after the UI check, which builds for its test port. The start command sets a 6 MB request limit for image uploads (5 MB image plus form overhead); if starting `build/index.js` directly, set `BODY_SIZE_LIMIT=6M` yourself.

## What works

Questions, blips, replies, likes, saved posts, following, nicknames, search, category/tag/user filters, popular and unanswered feeds, pagination. Blips accept one JPG, PNG, GIF or WebP image up to 5 MB, with preview and server-side signature/MIME/size validation. Failed writes keep the enhanced form's draft and selected file available to retry.

This remains a prototype, not an authenticated public social network. Browser profiles use isolated HTTP-only cookies, without password login or recovery. Add authentication and moderation before public launch. OpenRails 0.1 does not expose atomic conditional writes/transactions: this app serializes relation toggles and nickname changes locally and must run as **one app instance**. A failed post write can leave an unreferenced image; content hashing reuses the same file on retry.

Mountain photograph from Unsplash; pixel avatars are drawn locally. No affiliation with Zapytaj or Blip.
