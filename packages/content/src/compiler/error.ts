export interface ContentCompileIssue {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export class ContentCompileError extends Error {
  constructor(readonly issues: readonly ContentCompileIssue[]) {
    super(issues.map((issue) => `${issue.file}:${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ContentCompileError';
  }
}
