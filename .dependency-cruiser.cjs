/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Runtime circular dependencies make code hard to reason about and can crash at load time. Type-only cycles are erased at compile and allowed.',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Modules imported by nothing are usually dead code.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)tsconfig[^/]*\\.json$',
          '(^|/)(eslint|vite|vitest|playwright)\\.config\\.[cm]?[jt]s$',
          '(^|/)src/(main\\.tsx?|index\\.ts)$',
        ],
      },
      to: {},
    },
    {
      name: 'engine-not-into-web-or-server',
      severity: 'error',
      comment:
        'The deterministic engine must not depend on app layers (web/server) or content compiler internals.',
      from: { path: '^packages/engine/src' },
      to: { path: '^(apps/web|apps/server)/src' },
    },
    {
      name: 'content-not-into-engine-or-apps',
      severity: 'error',
      comment: 'The content package is a leaf; it must not depend on engine or app layers.',
      from: { path: '^packages/content/src' },
      to: { path: '^(packages/engine|apps/web|apps/server)/src' },
    },
    {
      name: 'model-not-into-compiler',
      severity: 'error',
      comment:
        'Content model modules must not import from the compiler layer (keeps the vocabulary source one-directional).',
      from: { path: '^packages/content/src/model' },
      to: { path: '^packages/content/src/compiler' },
    },
    {
      name: 'server-not-into-web',
      severity: 'error',
      comment: 'The server must not import from the web client.',
      from: { path: '^apps/server/src' },
      to: { path: '^apps/web/src' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.(test|spec)\\.[jt]sx?$|/test/|/dist/|node_modules)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts'],
    },
  },
};
