# Desktop GUI

The desktop application uses Electron with a React Renderer and shares its
presentation implementation through `@novel/ui`.

The desktop package contains the platform-neutral application composition, a
production `ElectronApiTransport`, a fixed versioned Main/Preload IPC protocol,
sender-scoped Main lifecycle control, a secure Electron application/window
factory, and the Vite/ReactDOM Renderer bootstrap. Runtime placement,
executable Host composition, and packaging remain later steps.

The secure desktop shell includes real Electron Main and Preload bindings, an
injected application factory, and a primary BrowserWindow lifecycle manager.
The final executable bootstrap still waits for local Host composition.

The sandboxed Preload is bundled as the single CommonJS file
`dist/preload/preload.cjs`; the window manager rejects non-`.cjs` Preload paths.

The Renderer is built by Vite into `dist/renderer-app` with relative asset URLs
for `loadFile()`. Its bootstrap validates the five-method `window.novelDesktop`
surface, injects the shared white `DesktopNovelApp`, and exposes no Electron or
Node object to React.

The Renderer must never import Node-only Core adapters or unrestricted Electron
APIs. Desktop capabilities enter shared UI through explicit platform ports and
bounded extension contracts.

The Preload bridge exposes only request, request cancellation, and pull-based
subscription operations. It does not expose `ipcRenderer`, filesystem access,
process execution, credentials, or Node objects to React.

Main requires an explicit sender authorization policy. Active requests and
subscriptions are owned by sender ID and are cancelled or closed when that
sender is released or the controller is disposed.

Run `pnpm smoke:client-shells` from the repository root to mount Desktop and Web
side by side and verify that both retain the same shared menu, context, project
navigation, Conversation list, Inspector transition, platform defaults, and
teardown semantics.
