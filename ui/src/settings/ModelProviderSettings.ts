/** Provider-neutral, non-secret model settings presented by shared clients. */
export interface ModelProviderSettingsInput {
  readonly name: string;
  readonly providerId: string;
  readonly api: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}

export interface ModelProviderSettings extends ModelProviderSettingsInput {
  readonly id: string;
}

export function captureModelProviderSettingsInput(
  input: ModelProviderSettingsInput,
): ModelProviderSettingsInput {
  const name = captureRequired(input.name, "name");
  const providerId = captureRequired(input.providerId, "providerId");
  const api = captureRequired(input.api, "api");
  const modelId = captureRequired(input.modelId, "modelId");
  const baseUrl = input.baseUrl?.trim();
  return Object.freeze({
    name,
    providerId,
    api,
    modelId,
    ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
  });
}

export function freezeModelProviderSettings(
  settings: ModelProviderSettings,
): ModelProviderSettings {
  return Object.freeze({ ...settings });
}

function captureRequired(value: string, field: string): string {
  const captured = value.trim();
  if (captured.length === 0) {
    throw new Error(`MODEL_PROVIDER_${field.toUpperCase()}_REQUIRED`);
  }
  return captured;
}
