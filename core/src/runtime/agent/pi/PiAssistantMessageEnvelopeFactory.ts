/** Supplies active Pi model identity when rebuilding canonical Assistant history. */
export interface PiAssistantMessageEnvelope {
  readonly api: string;
  readonly provider: string;
  readonly model: string;
}

export interface PiAssistantMessageEnvelopeFactory {
  create(): PiAssistantMessageEnvelope;
}
