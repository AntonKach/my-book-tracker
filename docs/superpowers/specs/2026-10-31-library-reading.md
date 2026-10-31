# Library and reading tracker

User authorization: implement all proposed library and reading features, without an artificial book-count limit. Existing app is a vanilla JavaScript PWA. Keep it deployable as static files and preserve cover/ISBN scanning.

## Design
Two views share each book: library (classification, tags, physical copies, location and loans) and reading (independent sessions, progress, notes, ratings). Add yearly goals, reading statistics and explainable recommendations from unread owned books. Show editable metadata before saving. Manual entry and ISBN lookup work without an AI key. Google Books then Open Library supply bibliographic facts; AI suggestions never replace them automatically.

Persist locally in IndexedDB first; distinguish local durability from verified cloud synchronization. Supabase is optional, authenticated, owner-isolated PostgreSQL with indexed search and paginated retrieval. No arbitrary book count cap; browser/disk/cloud quotas still apply. Cloud conflicts must not overwrite another device silently. Settings and private imports must never enter Git. A cloud project is not yet provided, so deliver setup migration and validate it locally if possible.

Book document: id (UUID), title, author, isbn, category, subcategory, tags[], summary, coverUrl, publisher, year, language, pageCount, copies[{id,ownership,location,loanTo,loanDate,loanDue}], readings[{id,status,currentPage,startedAt,finishedAt,rating,notes}], sources[], createdAt, updatedAt, archived, revision. ownership: owned/borrowed/wishlist; status: want/reading/paused/finished/abandoned. Copies and reading sessions retain separate identities. ISBN identifies editions, not physical copies. Potential duplicates require a decision.

Import existing Greek-header Sheets CSV with preview and malformed-row reporting. JSON backup preserves all fields, IDs and history; CSV is a flat exchange format. Import is explicit; do not publish the user's library. Preserve legacy localStorage queue, recover its records into IndexedDB without claiming legacy Apps Script delivery was verified.

UI: Greek, accessible labeled forms/dialogs, responsive dark ink/warm paper design, library/reading/statistics navigation, 24-item pagination. Search ignores Greek accents/case/final sigma. PWA caches only static same-origin assets, never auth/API responses. Auth credentials are not exported. Do not autosend emails or notifications.

## Approaches
User delegated implementation with "Προχώρα με όλα". Chosen: retain vanilla PWA, add IndexedDB plus optional Supabase. Sheets-only would keep a fragile write-only transport; a full framework rewrite adds deployment overhead without necessary user value. Existing Sheet remains intact and becomes import/export source.

## Verification
Domain/import tests; real IndexedDB via fake-indexeddb tests; cloud failure/auth/conflict tests; SQL integration and RLS where local PostgreSQL runtime is available; browser smoke for create/edit/reload/filter/reading/history/import/export/responsive views. Never claim live Supabase verification without an actual connection.
