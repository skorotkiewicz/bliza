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

Runtime storage uses OpenRails collections and its read-only SQL API for feeds and counts. Images go to OpenRails file storage and are streamed through `/media/…`, without exposing the service key or expiring download links. Each namespace uses its own collections and image directory. Empty namespaces stay empty by default. Set `SEED_DEMO=true` before their first initialization to install the fictional conversations. Existing namespaces are never reset.

The app requires `openrails >=0.1.1` and an updated backend supporting `POST /fn/data/kv/transaction` and `POST /fn/data/files/gc`. Conditional KV writes use backend transactions, not process-local locks. Post records and image metadata commit together; retries reuse the form's post UUID. Feed SQL remains read-only. `/healthz` checks transaction capability without changing records and returns 503 when unavailable.

All portal data and uploaded images are stored on the configured OpenRails server.

## Checks and production

```sh
bun run test
bun run test:ui
# Entirely isolated local backend, integration and browser checks:
OPENRAILS_BACKEND_BIN=/path/to/openrails-backend bun run test:release
bun run build
bun run start
```

Storage integration checks require `OPENRAILS_TOKEN`; image-validation checks run without it. Browser checks require the token and system Chromium (`CHROMIUM_PATH` can override `/usr/sbin/chromium`). Each check creates a unique remote test namespace, leaving test records and uploaded test images there, rather than modifying portal data. UI screenshots are saved in a temporary local directory.

Production builds default to `http://localhost:3000`. For public deployment, export `ORIGIN=https://your-portal.example` before both `bun run build` and `bun run start`, and terminate HTTPS at the portal's reverse proxy. Non-loopback HTTP production requests are rejected. Use a dedicated hostname and set the proxy's request limit to at least 6 MB for portal uploads, and at least 8 MB for the backend's base64 transaction requests. Rebuild normally after the UI check, which builds for its test port. The start command sets a 6 MB request limit for image uploads (5 MB image plus form overhead); if starting `build/index.js` directly, set `BODY_SIZE_LIMIT=6M` yourself.

## What works

Questions, blips, replies, likes, saved posts, following, nicknames, search, category/tag/user filters, popular and unanswered feeds, pagination. Blips accept one JPG, PNG, GIF or WebP image up to 5 MB, with preview, signature/MIME validation and real raster decoding. Images are limited to 16 million pixels, resized within 1920 × 1920, re-encoded as WebP and stripped of EXIF metadata. Processed images must also fit within 5 MB. Hidden content and banned authors disappear from feeds, counts and public media responses; media is not cached. Moderators retain authenticated previews. Already downloaded copies cannot be recalled. Failed writes keep the enhanced form's draft and selected file available to retry.

### Return tickets

Start without registration, then open your profile and choose **Zabierz swój nick do domu** to download `bilet-powrotny.txt`. On another browser choose **Mam bilet!**, drop/select the file and click **Wracam do siebie**. The same account returns, including its posts, bookmarks and follows. Changing the nickname does not break the ticket.

Each ticket contains a random 256-bit recovery key. OpenRails stores only its SHA-256 hash, separately from public profiles. Downloads are authenticated, POST-only, CSRF-protected and marked `no-store`; return attempts are size-limited and throttled. Recovery creates a fresh HTTP-only session, not a copy of the original cookie. Tickets work repeatedly until replaced; replacing one requires explicit confirmation and atomically invalidates the old file and every other session. The browser issuing the replacement stays logged in. A failed download can still have issued a ticket: reload and confirm replacement to retry while your browser session remains active.

**Treat the file like a key.** Anyone holding it can access the account. Losing both the file and browser session means losing access. Switching accounts does not merge the previous profile's activity or drafts. Use HTTPS for both the portal and backend outside a trusted LAN.

### Moderation and manual approval

Set a **separate** server-side `ADMIN` secret with 32–256 printable ASCII characters without spaces, for example `openssl rand -hex 32`. Never reuse `OPENRAILS_TOKEN`. Empty or invalid `ADMIN` disables `/admin`, including its actions. The login uses an HTTP-only, SameSite Strict cookie, an eight-hour expiry, server-side revocation, CSRF protection and a shared five-attempts-per-minute IP limit. Rotate the secret and restart all instances to invalidate administrator sessions.

Guests can browse, save, follow, like, edit their nickname and report content. **Publishing and replying require moderator approval by default.** Set server-side `REQUIRE_APPROVAL=false` and restart the app to make approval voluntary. This removes the publishing notice and enables post/reply forms; moderation, bans and approval badges remain unchanged. Set `REQUIRE_APPROVAL` consistently on every app instance. In the profile, the owner sends a short note and receives a code. The moderator confirms contact through an agreed channel, matches that code and approves the account in `/admin`. No email is used. This is community approval and proof of contact with the account holder, **not legal-identity verification**. Do not collect identity documents or sensitive data in notes.

The admin panel has reports, accounts, posts, replies and an audit log. Hiding, restoring, approval changes, bans and forced account logout require a reason. Banning revokes every session and blocks ticket recovery; unbanning does not revive old sessions. Content hiding is reversible and does not delete portal records.

### Devices and concurrency

Profiles show active devices using approximate browser/OS labels. Owners can revoke individual sessions, log out other devices or explicitly log out this browser. Revoked sessions cannot mutate through any application instance. Sessions and tickets are checked again inside conditional writes. Session tokens are stored only as hashes. Ordinary logout does not invalidate a ticket, so replace a leaked file as well.

Multiple app instances must share the same authoritative OpenRails project, namespace and `ADMIN` configuration. Keep their clocks synchronized. Independent backend copies are not a cluster. Rate limits, nickname reservations, relation toggles and ticket rotation are enforced through backend conditional transactions. Under persistent contention an operation returns 409 rather than silently losing a write.

### File maintenance and deployment

New image metadata and its post are atomic, so failed post persistence does not publish an unreferenced upload. A crash or failed filesystem/SQL commit can leave a private, unreferenced temporary blob. The explicitly confirmed admin cleanup removes only server-generated blobs and temporary files that no file metadata references, across the OpenRails project. It preserves portal records and all referenced files, including hidden images. Cleanup holds the backend writer lock while scanning, so run it off-peak on large projects.

Before upgrading the backend, take a consistent backup of its database and file directory, deploy the updated binary, and verify `/healthz`. Configure a strong `ADMIN`, public HTTPS and the production `ORIGIN` on every instance. The LAN backend still needs the actual update before this build can serve portal data. Do not bypass an SSH host-key mismatch: verify the new fingerprint through a trusted channel first.

`test:release` starts a temporary local backend with random credentials and separate namespaces. It checks two application processes, approval, moderation, image access, ticket rotation, session revocation, disabled admin access, CSRF, file validation, keyboard access, no-JavaScript publishing and 320/390/1440px layouts. It leaves only its own temporary test data. No portal namespace is reset.

Mountain photograph from Unsplash; pixel avatars are drawn locally. No affiliation with Zapytaj or Blip.
