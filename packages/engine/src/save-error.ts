export type SaveLoadErrorKind = 'malformed_json' | 'invalid_save' | 'unsupported_version';

export class SaveLoadError extends Error {
  constructor(
    readonly kind: SaveLoadErrorKind,
    readonly path: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SaveLoadError';
  }
}
