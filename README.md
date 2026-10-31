# BookTracker

A Greek-language personal library and reading journal, deployable as a static PWA.

- Catalog books by category, subcategory, tags, ISBN, publisher and language.
- Track separate physical copies, shelf locations and loans.
- Keep independent reading sessions, progress, dates, notes and ratings, including rereads.
- Search without Greek accents/case differences; paginate the collection.
- Set yearly reading goals, see monthly statistics, and choose unread books from your own shelves.
- Scan ISBN barcodes or optionally recognize a cover with a personal Gemini key; review metadata before saving. Manual entry and ISBN lookup require no AI key.
- Import Greek-header Google Sheets CSV or restore a full JSON backup. Potential duplicates are reviewed or skipped; originals are not deleted.
- Store changes durably in IndexedDB. Optional Supabase synchronization confirms database writes and exposes conflicts for a user decision.

## Start locally

```sh
npm ci
npm run serve
```

Open http://localhost:8080. `file://` is unsupported. No backend is needed for the local library. Install the PWA using the browser's install/Add to Home Screen action on HTTPS or localhost.

## Cloud setup

See [the Supabase setup guide](docs/cloud-setup.md). Apply the checked-in SQL migration to a new project, create your auth account, then enter the project URL, **publishable/anon key**, email and password in Settings. Never put a service-role key, database password or personal library in this repository.

The local library and each cloud account use separate IndexedDB databases. Choose **Μεταφορά τοπικής συλλογής στο cloud** explicitly after sign-in. The originals remain in the local library. Sign-out returns to the local collection. Offline cloud mode includes only books previously cached on that device; it is not a full offline mirror of the server.

Remote writes are revision checked and idempotent. If another device edited a book, the local change remains queued until you choose the cloud version or explicitly keep your version. A network dispatch is never presented as a verified database save.

## Existing Google Sheet

In Google Sheets use File → Download → CSV. In BookTracker open Settings → Import CSV / JSON. Recognized columns include Ημερομηνία, Τίτλος, Συγγραφέας, Κατηγορία, Περίληψη and ISBN (including the legacy unnamed sixth column). Review the preview and malformed rows. Existing records are skipped unless you explicitly keep duplicates. This import does not overwrite existing books. Capture dates from the old Sheet are preserved in provenance; ambiguous locale timestamps are not silently converted into a timezone.

JSON is the complete backup format (copies, reading history, notes, goals and IDs). CSV exports bibliographic fields and the first copy's location for spreadsheet use, not the full history. Spreadsheet formulas are neutralized on export. Credentials and login sessions are never included in exports. Back up before clearing browser storage.

## Capacity and scaling

There is **no imposed book-count limit**. Actual capacity depends on browser storage, device resources and the Supabase plan. Local browsing uses cursors with bounded result pages; local full-text search/statistics scan the local collection without loading it all into memory. Cloud search is performed in PostgreSQL with owner indexes and a trigram GIN index; results are paginated. One- or two-character searches may scan. File import/export is limited by available browser memory, not an artificial book counter. Cloud database and browser quotas are not infinite.

Goals are private per cloud account; changing a cloud goal requires an online connection. Recommendations are deterministic (unread owned books, wish-to-read first, oldest first), not an external AI profiling service. Completion statistics count reading sessions, so rereads count again. Page statistics use the book's current page count for completed sessions.

## Validation

```sh
npm test              # domain, import/export, IndexedDB, cloud adapter, SQL/RLS in PGlite
npm run check         # JavaScript syntax
npx playwright install chromium
npm run test:browser  # desktop/mobile workflows
```

The database tests create isolated test auth roles and run the real migration in embedded PostgreSQL. Live Supabase service configuration, real camera hardware and paid AI calls need a connected deployment to verify.

## Privacy and dependencies

Bibliographic lookups contact Google Books and Open Library. Cover recognition sends the selected compressed image to Gemini only when requested. Its personal key is session-only in the browser; use only on a trusted device. Supabase auth tokens are browser-accessible by design and isolated per project. Book pages escape user data and accept HTTPS cover images. Only static app assets are cached by the service worker.

The barcode library is pinned and vendored with its license in `vendor/`, so manual browsing and the scanner's code can load offline. Catalog lookups and AI recognition still require a network connection. No scrape proxy is used.
