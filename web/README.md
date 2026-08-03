# Web

The Web application uses the same `@novel/ui` React tree as the desktop
Renderer and provides browser-specific platform ports and extensions.

The current Web request checkpoint contains the thin application composition
entrypoint and a browser `HttpApiRequestClient` for the request half of the
future HTTP/WebSocket Transport.

Requests use `POST /api/v1/requests`, JSON Core protocol envelopes,
`credentials: include`, no-store caching, redirect rejection, and a no-referrer
policy. Optional authentication headers enter through an injected provider and
are never logged. WebSocket Event streaming, authentication UI, remote
Workspace behavior, Vite bootstrap, and deployment remain later Web steps.
