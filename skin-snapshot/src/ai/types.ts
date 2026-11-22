import type { PathId, PhotoSlot } from '../core/types';

export interface AnalyzeImage {
  slot: PhotoSlot;
  mime: 'image/jpeg';
  bytes: Uint8Array;
}

export interface AnalyzeInput {
  path: PathId;
  images: AnalyzeImage[];
  /** The only non-photo context sent to the provider. Health answers are never sent. */
  makeupToday: boolean | null;
  /** Free-form per-call hint for the mock provider's scenarios. Ignored by real providers. */
  scenario?: string;
}

export interface ProviderOutput {
  /** Raw structured output, validated by core/validate-output before use. */
  raw: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: AnalyzeInput, signal?: AbortSignal): Promise<ProviderOutput>;
}

export class ProviderError extends Error {
  constructor(
    public code: 'not_configured' | 'timeout' | 'http' | 'bad_response' | 'refused',
    message: string,
    public status?: number,
  ) {
    super(message);
  }
  get retryable() {
    return this.code === 'timeout' || (this.code === 'http' && (this.status ?? 500) >= 500) || this.code === 'bad_response' || this.status === 429;
  }
}
