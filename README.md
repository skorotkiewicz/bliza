# bliza.

A Polish question-and-answer portal mixed with 160-character microblogging, inspired by the old Zapytaj and Blip communities. Built with SvelteKit, Bun and SQLite.

```sh
bun install
bun run dev
```

Open the URL printed by Vite. Requires Bun 1.3 or newer; SQLite uses `bun:sqlite`, so run through the provided Bun scripts, not Node.

```sh
bun run test
bun run test:ui
bun run build
bun run start
```

The UI check starts an isolated production server and uses system Chromium (`CHROMIUM_PATH` can override `/usr/sbin/chromium`). It leaves screenshots and a test database in a temporary directory, without touching portal data.

Production builds default to `http://localhost:3000`. For deployment, set the trusted public `ORIGIN` **at build time**: `ORIGIN=https://your-portal.example bun run build`, then `bun run start`. SvelteKit 3 uses this build-time origin for CSRF protection. Rebuild normally after the isolated UI check, which builds for its test port. To choose a database location, set `DB_PATH=/absolute/path/bliza.sqlite`. The default is `bliza.sqlite` in the working directory. Keep this file and its WAL files on persistent storage and back it up.

## What works

Questions, blips, replies, likes, saved posts, following, nicknames, search, category/tag/user filters, popular and unanswered feeds, pagination. All community data persists in SQLite. The first run adds fictional Polish conversations; it does not re-seed an existing database.

This is a local prototype, not an authenticated public social network. Each browser gets an isolated, HTTP-only cookie profile. Clearing the cookie loses access to that profile; no password login or account recovery is provided. Do not publish private information. Add authentication and moderation before opening it to the public. The database supports a single app instance.

Mountain photograph from Unsplash. Pixel avatars are drawn locally. No affiliation with Zapytaj or Blip.
