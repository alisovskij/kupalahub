# Assistant integration review

Read-only review of `server/assistant.js`, `server/app.js`, `ai_service/app.py`, and the assistant UI.

## Findings and resolution

- **Consent disclosure — resolved.** The UI now says DeepSeek receives the user's name and group, tasks, schedule, notes, and the latest 12 history messages. It also explains that the history is stored here (up to 40 messages) and can be cleared. See `web/src/assistant/AssistantPage.jsx:99-100`; the server payload includes the history and profile fields described there.
- **Backend callback URL — resolved.** `_valid_backend_url()` rejects URLs with credentials, query/fragment, or non-root paths; plain HTTP is limited to `localhost`, loopback, and the `backend` service hostname, while other hosts require HTTPS. Invalid configuration prevents the AI service from becoming ready. See `ai_service/app.py:184-208`.
- **AI service URL — resolved.** `AI_SERVICE_URL` rejects credentials, query/fragment, and non-root paths; plain HTTP is limited to loopback, `localhost`, or the `ai` service hostname. Other hosts must use HTTPS. See `server/assistant.js:35-38`.

## Scope checked

Session-backed routes use per-session CSRF checks for `/api` mutations. Tool grants bind user, scope, request ID, short expiry, and active request; tools are bounded and do not execute task writes. Proposal confirmation is owner/scope filtered, expiry checked, transaction-wrapped, idempotent after confirmation, and task updates use a base-state hash. Sources are allowlisted server-side and rendered as text or same-app links. No secret logging path was found in the inspected code.

## Verification

My recheck was static and read-only; I did not run tests or contact the provider. The parent reports 7 Node tests, 8 Python tests, and the frontend build passed after these changes.
