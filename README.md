# My Book Tracker

A lightweight progressive web app for scanning books, enriching their metadata with Gemini, and dispatching records to a Google Apps Script web app.

## Configuration

Open the settings panel in the app and provide:

- a Gemini API key;
- an optional deployed Google Apps Script web-app URL.

Configuration is stored only in the current browser. Do not commit keys or deployment URLs to this public repository. For production or multi-user use, place Gemini and database access behind a trusted backend instead of distributing credentials to browsers.

## Offline synchronization

When a dispatch cannot be completed, the book is retained in a local offline queue. Queued books are removed individually only after the browser successfully dispatches their request. Because the Apps Script request uses an opaque `no-cors` response, the client can confirm network dispatch but cannot verify server-side insertion.

## Local development

Serve the repository over HTTP; service workers do not behave correctly when the page is opened directly from `file://`.

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Security notes

- The barcode dependency is pinned to a specific version.
- A Content Security Policy limits scripts and network destinations.
- API credentials remain browser-accessible by design; a backend proxy is the recommended next step for stronger protection.
