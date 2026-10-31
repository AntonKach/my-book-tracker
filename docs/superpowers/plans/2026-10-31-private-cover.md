# Private Cover Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Signed-in iPhone users recognize book covers without entering a Gemini key.
**Architecture:** Static client sends a JPEG to a private Supabase function. Validated owner session is required; only the function holds Gemini credentials.
**Tech Stack:** Vanilla JS, Supabase Edge runtime, Node tests, Playwright Chromium/WebKit.
**Spec:** docs/superpowers/specs/2026-10-31-private-cover-design.md

## Global Constraints
- No secret in git, static assets, screenshots or browser storage.
- Existing owner UUID only; JWT verification stays enabled; no billing change.
- Existing library and user data remain unchanged.
- Cloud session refresh works after app restart; no automatic book save.

## Review Focus
- Expired user token refresh before recognition.
- Anonymous, service-key and wrong-user callers never reach Gemini.
- Large/malformed image and provider failures do not disclose credentials.
- Reload/new mobile context does not need a browser Gemini key.
- Offline and signed-out paths explain the next action without opening a photo picker.

### Task 1: Private endpoint
Files: supabase/functions/recognize-cover/index.js, tests/cover-function.test.js, supabase/config.toml.
Interface: export createCoverHandler({env,fetchImpl}) => async (Request)=>Response; POST {image} returns proposed book fields.
- [ ] Write tests for all request/auth/input/error boundaries and successful sanitized extraction; run RED.
- [ ] Implement handler with bounded body, Auth validation and owner check; run GREEN.
- [ ] Store existing key as project secret and deploy with verify_jwt true; verify denied anonymous invocation.

### Task 2: Client integration
Files: js/cloud.js, js/api.js, app.js, index.html, sw.js, tests/cloud.test.js, e2e/scanner.spec.js.
Interface: CloudClient.recognizeCover(image) calls /functions/v1/recognize-cover with refreshed bearer session; timeout 35 seconds.
- [ ] Write tests for session refresh, no-key mobile reload, no direct Gemini request, offline/login guards; run RED.
- [ ] Replace session key UI with login-based recognition, remove direct Gemini helper and clear old session key; run GREEN.
- [ ] Update setup docs, full checks/tests and WebKit tests; request one focused independent security review.

### Task 3: Release and live proof
- [ ] Fix any important review findings with regression tests.
- [ ] Create and attach PR, wait for CI, merge and verify Pages build.
- [ ] Real signed-in request with test cover and no browser key succeeds; anonymous denied; capture UI proof; no test book saved.
