# Web

The Web application uses the same `@novel/ui` React tree as the desktop
Renderer and provides browser-specific platform ports and extensions.

The current Web request checkpoint contains the thin application composition
entrypoint and a browser `HttpApiRequestClient` for the request half of the
future HTTP/WebSocket Transport.

Requests use `POST /api/v1/requests`, JSON Core protocol envelopes,
`credentials: include`, no-store caching, redirect rejection, and a no-referrer
policy. Optional authentication headers enter through an injected provider and
are never logged.

WebSocket Event subscriptions connect to `/api/v1/subscriptions` with the
`novel.api.v1` subprotocol. Each subscription owns one socket, uses explicit
open/close JSON messages, requires exact subscription identity, and enforces a
bounded Event queue. Authentication UI, remote Workspace behavior, composed
HTTP/WebSocket `ApiTransport`, Vite bootstrap, and deployment remain later Web
steps.

`HttpWebSocketApiTransport` now composes both halves behind the Core
`ApiTransport` contract. Closing it aborts and waits for active HTTP requests,
then closes every Event subscription. Automatic reconnect, browser bootstrap,
authentication UI, and the production Host remain later steps.
