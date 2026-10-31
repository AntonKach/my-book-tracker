# Private cover recognition

The owner wants cover recognition on iPhone without repeatedly entering a Gemini key. Reuse the existing Supabase login on every device. The Gemini key lives only in Supabase Edge Function secrets; the static site never contains or receives it.

Approaches: browser localStorage would persist a credential only on one browser and leave it accessible there; an authenticated backend supports all signed-in devices. Use the backend within the user's already authorized Supabase project. Public signup remains disabled. Permit only the configured owner UUID after validating their bearer token against Supabase Auth, in addition to the platform JWT check.

Create `recognize-cover` accepting one bounded JPEG data URL. Validate origin, method, auth, size and image format before calling Gemini. Return only normalized proposed book fields; keep explicit review before save. Use safe Greek errors without returning provider errors or secrets. Do not change book storage, RLS, account passwords, or billing.

The app uses `CloudClient.recognizeCover(image)` with automatic session refresh. Remove browser key entry/storage and direct Gemini requests; signed-out users are sent to cloud login. Show a clear offline message. Bump the service-worker cache. Verify a fresh mobile/WebKit context with a saved login and no Gemini key, successful cloud recognition, and denial without a user session. A real device camera is outside automated coverage.
