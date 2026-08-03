# Desktop GUI

The desktop application uses Electron with a React Renderer and shares its
presentation implementation through `@novel/ui`.

The current Renderer checkpoint contains the platform-neutral application
composition and a production `ElectronApiTransport` over a narrow JSON-safe
Preload capability interface. Electron Main and Preload implementations,
Runtime placement, Vite, and packaging remain later GUI steps.

The Renderer must never import Node-only Core adapters or unrestricted Electron
APIs. Desktop capabilities enter shared UI through explicit platform ports and
bounded extension contracts.

The Preload bridge exposes only request, request cancellation, and pull-based
subscription operations. It does not expose `ipcRenderer`, filesystem access,
process execution, credentials, or Node objects to React.
