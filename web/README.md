# Web

The Web application uses the same `@novel/ui` React tree as the desktop
Renderer and provides browser-specific platform ports and extensions.

The Web package now includes a Vite/ReactDOM browser bootstrap around the same
shared `@novel/ui` tree used by Electron. The bootstrap derives the API origin
from `window.location.origin`, composes `HttpWebSocketApiTransport` with
`DefaultNovelApiClient`, injects a browser-safe `FrontendPlatform`, and closes
the Transport when the page unloads.

HTTP requests use `POST /api/v1/requests`, JSON Core protocol envelopes,
`credentials: include`, no-store caching, redirect rejection, and a no-referrer
policy. Optional authentication headers enter through an injected provider and
are never logged.

WebSocket Event subscriptions connect to `/api/v1/subscriptions` with the
`novel.api.v1` subprotocol. Each subscription owns one socket, uses explicit
open/close JSON messages, requires exact subscription identity, and enforces a
bounded Event queue.

`HttpWebSocketApiTransport` now composes both halves behind the Core
`ApiTransport` contract. Closing it aborts and waits for active HTTP requests,
then closes every Event subscription. The production build emits relative
static assets to `dist/browser-app` with a restrictive browser CSP.

Run `pnpm --dir web dev` for the local Vite shell and
`pnpm --dir web smoke:web-browser-bootstrap` for the focused DOM and production
artifact validation. Authentication UI, remote Workspace behavior, automatic
reconnect, deployment policy, and the production Web Host remain later steps.
