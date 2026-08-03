# Desktop GUI

The desktop application uses Electron with a React Renderer and shares its
presentation implementation through `@novel/ui`.

The current desktop protocol checkpoint contains the platform-neutral
application composition, a production `ElectronApiTransport`, a fixed
versioned Main/Preload IPC protocol, and sender-scoped Main lifecycle control.
Runtime placement, Electron entrypoints, window creation, Vite, and packaging
remain later GUI steps.

The Renderer must never import Node-only Core adapters or unrestricted Electron
APIs. Desktop capabilities enter shared UI through explicit platform ports and
bounded extension contracts.

The Preload bridge exposes only request, request cancellation, and pull-based
subscription operations. It does not expose `ipcRenderer`, filesystem access,
process execution, credentials, or Node objects to React.

Main requires an explicit sender authorization policy. Active requests and
subscriptions are owned by sender ID and are cancelled or closed when that
sender is released or the controller is disposed.
