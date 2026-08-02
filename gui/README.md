# Desktop GUI

The desktop application uses Electron with a React Renderer and shares its
presentation implementation through `@novel/ui`.

The current checkpoint contains only the platform-neutral Renderer composition
entrypoint. Electron Main, Preload, IPC Transport, Runtime placement, Vite, and
packaging remain later GUI steps.

The Renderer must never import Node-only Core adapters or unrestricted Electron
APIs. Desktop capabilities enter shared UI through explicit platform ports and
bounded extension contracts.
