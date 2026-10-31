# Library and reading implementation plan

> Execute the approved scope continuously; use focused parallel work for cloud adapter and SQL, and one final independent review.

**Goal:** A complete personal library and reading PWA without an imposed collection-size limit.
**Architecture:** Static vanilla JavaScript, local IndexedDB durability, optional authenticated Supabase sync with optimistic concurrency and server-side pagination.
**Tech Stack:** ES modules, IndexedDB, Node test runner, Playwright, PostgreSQL/Supabase REST.
**Spec:** ../specs/2026-10-31-library-reading.md

## Global constraints
Greek UI; no private data committed; no service-role keys in browser; retain scanning; no destructive migration; no claim of infinite physical capacity.

## Review focus
- Retry after lost write acknowledgment must be idempotent.
- Concurrent device edits must remain recoverable.
- Greek accent and final-sigma matching must agree locally and remotely.
- Legacy CSV/queue import must not lose malformed or duplicate records silently.
- Reading/copy changes survive reload and JSON round trip.

## Tasks
- [x] Domain and exchange: js/domain.js, js/import-export.js; test ISBN normalization, taxonomy, session validation, duplicates, quoted CSV and JSON round trips.
- [x] Local persistence: js/library-store.js; cursor pagination/search, transactional book+outbox writes, revision-safe acknowledgment, stats and recommendation selection. Tests use real IndexedDB semantics.
- [x] Cloud: js/cloud.js and supabase/migrations/*.sql; sign-in, token refresh, owner-scoped queries, revision RPC, stats RPC and paginated search. Test errors/conflicts and SQL policies.
- [x] Interface: replace app.js/index.html/index.css; library/reading/stats, scan preview, full editor, copies/loans/session history, backup/import, settings and cloud sync.
- [x] Hardening: replace scraping fallback with APIs, preserve metadata, safe images/CSV, cache update and CI, setup guide.
- [x] Verify: run full unit/database/browser checks, independent review, fix material findings, create reviewable GitHub PR and local output package. Do not merge before explicit request.
