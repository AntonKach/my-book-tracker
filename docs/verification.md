# Verification — 2026-10-31

- `npm test`: 39 passing tests (domain, exchange, IndexedDB, REST adapter and real migration in PGlite).
- `npm run check`: JavaScript syntax checks pass.
- `npm run test:browser`: 6 passing Chromium workflows, including mobile layout, offline reload, auth expiry, cloud batch duplicates and transfer retries. Cloud endpoints are intercepted fixtures; these are not a live Supabase deployment test.
- Actual legacy Sheet export: 31 records parsed without import errors; private CSV/JSON remain outside this public repository. A browser import with duplicate preservation displayed all 31 across 24-item pages, no uncaught errors and no horizontal mobile overflow.
- Independent read-only review found five material issues. All received failing regression tests and fixes: native fetch receiver; queuing after auth expiry; repeat transfer preserving new edits; duplicate detection in unsent batches; invalid timestamps hidden from indexes.
- Additional fixes preserve legacy capture dates in provenance and merge yearly goals without dropping other years. Simultaneous updates to the same goal use the latest confirmed write.

## Decisions and remaining activation

- The user authorized all features and no imposed collection size. Kept the existing static app stack; added local-first IndexedDB plus optional PostgreSQL/Supabase rather than continuing the unverified Apps Script transport.
- No user cloud project exists yet. SQL, authenticated client and setup guide are provided; provisioning and live service validation remain.
- Offline cloud mode is an on-demand cache of books already read on the device, not a full mirror. Complete collection browsing without network is available for the local library.
- Browser memory and service/storage quotas remain practical capacity limits. No artificial book-count cap is used.
- Real camera hardware and Gemini service calls were not exercised. Manual entry, import and ISBN adapter behavior were tested.

## Private cover recognition — 2026-10-31

- 48 unit/database/endpoint tests, 11 Chromium workflows and 4 WebKit scanner workflows pass.
- A new browser context with saved Supabase login and empty sessionStorage recognizes a test cover without a browser Gemini key; expired access tokens refresh before the call.
- Deployed `recognize-cover` with JWT verification enabled. An actual signed-in owner request recognized THE TEST BOOK / Alex Example. An anonymous-key request returned 401. No test book was saved.
- Tests cover wrong owner, anonymous Auth user, malformed/oversized body, CORS, provider rate limit/errors and no secret in responses.
- Real iPhone camera hardware has not been exercised; WebKit coverage includes mobile layout and file selection.
