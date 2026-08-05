# Debug Diagnostics

## Status

Implemented for the desktop child Runtime and the provider execution boundary.

## Debug Mode

The application configuration exposes diagnostic settings in the
`diagnostics` section (`ApplicationSettings.DiagnosticSettings`):

- `logLevel`: `"error" | "warn" | "info" | "debug" | "verbose"`. `"debug"`
  enables debug level output; `"verbose"` additionally enables provider
  request records through the desktop child file logger.
- `providerRequestDumpEnabled`: when `true`, every provider request is recorded
  as one JSONL record.
- `providerRequestDumpPath`: the file receiving the JSONL records.

Defaults are `logLevel: "info"`, `providerRequestDumpEnabled: false`, and no
dump path.

## Provider Request Dump

`PiProviderExecutionFactory` accepts an optional
`ProviderRequestDebugRecorder`. Before dispatching a request it captures a
`ProviderRequestDebugSnapshot` containing:

- `model`: id, name, provider, baseUrl, reasoning, contextWindow, maxTokens
- `config`: model profile/connection ids, provider kind, api, model id, base
  URL, organization/project/api version/region, resolved parameters,
  capability overrides, fallback profiles
- `options`: temperature, maxTokens, reasoning (never apiKey or headers)
- `prompt`: the system prompt (bounded)
- `messages`: the request messages (bounded, last N)
- `tools`: the tool schemes (bounded)

Secrets are never copied: credential references, secret headers, `apiKey`, and
authorization headers are excluded from the snapshot. Oversized fields are
truncated with a stable marker.

## Verbose Logging

The `Logger` interface exposes an optional `verbose` channel. The desktop
child file logger implements it when `logLevel` is `"verbose"` and writes one
`VERBOSE` record per provider request containing the same redacted snapshot
(model, config, options, prompt, messages, tools). Provider request snapshots
are only built when a debug recorder or a verbose-capable logger is present.

The Node adapter `createNodeProviderRequestDebugRecorder` appends one JSONL
line per request and never throws; a failed append is dropped with a debug log
that contains no path or content.

## Wiring

`runDesktopRuntimeChildEntrypoint` loads application diagnostics before
composition: it creates the Node recorder when the dump is enabled and passes
it into `PiRuntimeChildAdapterFactory`. The env file logger
(`NOVEL_DESKTOP_CHILD_LOG`) writes `DEBUG` lines when `logLevel` is `"debug"`.
