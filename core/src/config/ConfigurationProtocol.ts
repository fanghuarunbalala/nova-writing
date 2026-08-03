/** Common scope, sensitivity, and activation metadata for Settings clients. */
import { captureIdentity, captureNonBlank } from "./ConfigurationValues.js";

export type ConfigurationScope =
  | "built_in"
  | "application"
  | "workspace"
  | "conversation"
  | "session";

export type ConfigurationApplyMode =
  | "immediate"
  | "next_tool_call"
  | "next_provider_call"
  | "next_turn"
  | "next_conversation"
  | "workspace_reopen"
  | "application_restart";

export type ConfigurationSensitivity =
  | "public"
  | "private"
  | "credential_reference"
  | "secret";

export interface SettingDefinitionOptions {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scopes: readonly ConfigurationScope[];
  readonly applyMode: ConfigurationApplyMode;
  readonly sensitivity: ConfigurationSensitivity;
  readonly advanced?: boolean;
  readonly readOnly?: boolean;
}

export class SettingDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scopes: readonly ConfigurationScope[];
  readonly applyMode: ConfigurationApplyMode;
  readonly sensitivity: ConfigurationSensitivity;
  readonly advanced: boolean;
  readonly readOnly: boolean;

  constructor(options: SettingDefinitionOptions) {
    this.id = captureIdentity(options.id, "Setting Definition ID");
    this.label = captureNonBlank(options.label, "Setting label", 256);
    this.description = captureNonBlank(
      options.description,
      "Setting description",
      2_048,
    );
    this.scopes = captureScopes(options.scopes);
    this.applyMode = captureApplyMode(options.applyMode);
    this.sensitivity = captureSensitivity(options.sensitivity);
    this.advanced = options.advanced ?? false;
    this.readOnly = options.readOnly ?? false;
    Object.freeze(this);
  }
}

function captureScopes(value: readonly ConfigurationScope[]): readonly ConfigurationScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Setting scopes are invalid");
  }
  const captured = value.map((scope) => captureScope(scope));
  if (new Set(captured).size !== captured.length) {
    throw new TypeError("Setting scopes must be unique");
  }
  return Object.freeze(captured);
}

function captureScope(value: unknown): ConfigurationScope {
  if (
    value !== "built_in" &&
    value !== "application" &&
    value !== "workspace" &&
    value !== "conversation" &&
    value !== "session"
  ) {
    throw new TypeError("Configuration scope is invalid");
  }
  return value;
}

function captureApplyMode(value: unknown): ConfigurationApplyMode {
  if (
    value !== "immediate" &&
    value !== "next_tool_call" &&
    value !== "next_provider_call" &&
    value !== "next_turn" &&
    value !== "next_conversation" &&
    value !== "workspace_reopen" &&
    value !== "application_restart"
  ) {
    throw new TypeError("Configuration apply mode is invalid");
  }
  return value;
}

function captureSensitivity(value: unknown): ConfigurationSensitivity {
  if (
    value !== "public" &&
    value !== "private" &&
    value !== "credential_reference" &&
    value !== "secret"
  ) {
    throw new TypeError("Configuration sensitivity is invalid");
  }
  return value;
}
