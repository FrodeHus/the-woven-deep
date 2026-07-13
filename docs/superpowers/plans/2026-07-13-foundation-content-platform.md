# Foundation and YAML Content Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a runnable Dockerized TypeScript vertical slice that validates YAML game content, stores immutable compiled content packs in SQLite, serves the active pack through Fastify, and displays it in React.

**Architecture:** An npm workspace separates the browser-safe content model from the Node-only YAML compiler, the Fastify/SQLite server, and the React client. Server startup compiles the configured content directory before accepting traffic, persists the compiled pack by SHA-256 content hash, then serves both the client and content diagnostics. YAML is declarative data only; registered behavior identifiers remain TypeScript-owned.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript 5, React 19, Vite 7, Fastify 5, `yaml`, Zod 4, `better-sqlite3`, Vitest 3, Testing Library, Docker with `node:22-bookworm-slim`.

## Global Constraints

- The application is desktop-first and must remain usable without a persistent account.
- YAML contains no executable scripts, embedded expressions, or custom tags.
- Content paths are loaded in deterministic lexical order from `CONTENT_DIR`.
- Unknown YAML properties, duplicate IDs, unsafe aliases, invalid references, invalid registry keys, and semantic errors fail startup.
- Content hashes are based on normalized content, not YAML formatting or file order.
- Compiled packs are immutable and retained by hash in SQLite.
- The production container reads SQLite from `DATABASE_PATH`, defaulting to `/data/rogue.sqlite`.
- The server does not accept content uploads or content writes over HTTP.
- All package boundaries use explicit exported TypeScript interfaces.
- Every task follows red-green-refactor and ends with its own commit.

## Planned file structure

```text
.
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── app.ts                 # Fastify composition and routes
│   │   │   ├── config.ts              # Environment parsing
│   │   │   ├── content-bootstrap.ts   # Compile and persist startup pack
│   │   │   ├── content-repository.ts  # SQLite content_packs access
│   │   │   ├── database.ts            # SQLite connection and migrations
│   │   │   └── main.ts                # Process entrypoint
│   │   └── test/                       # Server and repository tests
│   └── web/
│       ├── src/
│       │   ├── App.tsx                 # Content diagnostics vertical slice
│       │   ├── api.ts                  # Typed content API client
│       │   ├── main.tsx                # React entrypoint
│       │   └── styles.css              # Living Tapestry foundation tokens
│       └── test/                        # Component tests
├── content/
│   ├── items/brass-lantern.yaml        # Initial declarative item
│   └── monsters/cave-rat.yaml          # Initial declarative monster
├── packages/
│   └── content/
│       ├── src/
│       │   ├── compiler/               # Node-only parsing and compilation
│       │   ├── model.ts                # Browser-safe pack and entry types
│       │   └── index.ts                # Public browser-safe exports
│       └── test/                        # Compiler and stable serialization tests
├── scripts/smoke.mjs                   # Production-container smoke test
├── Dockerfile
├── compose.yaml
├── package.json
└── tsconfig.base.json
```

---

### Task 1: Establish the typed workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/content/package.json`
- Create: `packages/content/tsconfig.json`
- Create: `packages/content/src/model.ts`
- Create: `packages/content/src/index.ts`
- Create: `packages/content/test/model.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `CONTENT_SCHEMA_VERSION: 1`
- Produces: `ContentId`, `ContentKind`, `ContentEntry`, and `CompiledContentPack`

- [ ] **Step 1: Write the failing model test**

```ts
// packages/content/test/model.test.ts
import { describe, expect, it } from 'vitest';
import { CONTENT_SCHEMA_VERSION, type CompiledContentPack } from '../src/index.js';

describe('content model', () => {
  it('publishes a versioned, immutable pack contract', () => {
    const pack: CompiledContentPack = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      hash: 'a'.repeat(64),
      entries: [],
    };

    expect(pack.schemaVersion).toBe(1);
    expect(pack.hash).toHaveLength(64);
  });
});
```

- [ ] **Step 2: Create workspace manifests and run the test to verify failure**

```json
// package.json
{
  "name": "the-woven-deep",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

```json
// packages/content/package.json
{
  "name": "@woven-deep/content",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Run: `npm install && npm test --workspace @woven-deep/content`

Expected: FAIL because `../src/index.js` does not exist.

- [ ] **Step 3: Add the base compiler configuration and model**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

```json
// packages/content/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

```ts
// packages/content/src/model.ts
export const CONTENT_SCHEMA_VERSION = 1 as const;

export type ContentId = string;
export type ContentKind = 'monster' | 'item';

export interface BaseContentEntry {
  readonly id: ContentId;
  readonly kind: ContentKind;
  readonly name: string;
  readonly glyph: string;
  readonly color: string;
  readonly tags: readonly string[];
}

export interface MonsterContentEntry extends BaseContentEntry {
  readonly kind: 'monster';
  readonly ai: string;
  readonly runAppearanceChance: number;
  readonly stats: {
    readonly health: number;
    readonly attack: number;
    readonly defense: number;
  };
}

export interface ItemContentEntry extends BaseContentEntry {
  readonly kind: 'item';
  readonly effect: string;
  readonly price: number;
}

export type ContentEntry = MonsterContentEntry | ItemContentEntry;

export interface CompiledContentPack {
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly hash: string;
  readonly entries: readonly ContentEntry[];
}
```

```ts
// packages/content/src/index.ts
export * from './model.js';
```

- [ ] **Step 4: Run tests and type checks**

Run: `npm test --workspace @woven-deep/content && npm run typecheck --workspace @woven-deep/content`

Expected: one passing test and zero TypeScript errors.

- [ ] **Step 5: Extend ignored generated files and commit**

Append these exact entries to `.gitignore`:

```gitignore
*.tsbuildinfo
data/
```

```bash
git add package.json package-lock.json tsconfig.base.json packages/content .gitignore
git commit -m "build: establish TypeScript workspace"
```

---

### Task 2: Parse strict YAML entries

**Files:**
- Modify: `packages/content/package.json`
- Create: `packages/content/src/compiler/error.ts`
- Create: `packages/content/src/compiler/schema.ts`
- Create: `packages/content/src/compiler/parse-file.ts`
- Create: `packages/content/src/compiler/index.ts`
- Modify: `packages/content/src/index.ts`
- Test: `packages/content/test/parse-file.test.ts`

**Interfaces:**
- Consumes: `ContentEntry` from `@woven-deep/content`
- Produces: `parseContentFile(input: { path: string; source: string }): readonly ContentEntry[]`
- Produces: `ContentCompileError` with structured `issues`

- [ ] **Step 1: Write parser tests for valid and unsafe YAML**

```ts
// packages/content/test/parse-file.test.ts
import { describe, expect, it } from 'vitest';
import { ContentCompileError, parseContentFile } from '../src/compiler/index.js';

describe('parseContentFile', () => {
  it('applies defaults to a strict monster entry', () => {
    const [entry] = parseContentFile({
      path: 'monsters/rat.yaml',
      source: `schemaVersion: 1
entries:
  - kind: monster
    id: monster.cave-rat
    name: Cave rat
    glyph: r
    color: '#a89b82'
    ai: ai.skittish
    stats: { health: 4, attack: 2, defense: 0 }
`,
    });

    expect(entry).toMatchObject({
      id: 'monster.cave-rat',
      tags: [],
      runAppearanceChance: 1,
    });
  });

  it('rejects unknown properties with a field path', () => {
    expect(() => parseContentFile({
      path: 'monsters/bad.yaml',
      source: `schemaVersion: 1
entries:
  - kind: monster
    id: monster.bad
    name: Bad
    glyph: b
    color: '#ffffff'
    ai: ai.skittish
    stats: { health: 1, attack: 1, defense: 0 }
    surpriseProperty: true
`,
    })).toThrowError(ContentCompileError);
  });

  it('rejects aliases and custom tags', () => {
    expect(() => parseContentFile({
      path: 'monsters/alias.yaml',
      source: 'schemaVersion: 1\nentries: &entries [*entries]\n',
    })).toThrow(/alias|YAML/i);
  });
});
```

- [ ] **Step 2: Install parser dependencies and verify failure**

Add these dependencies to `packages/content/package.json`:

```json
  "dependencies": {
    "yaml": "^2.8.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  },
"exports": {
  ".": "./dist/index.js",
  "./compiler": "./dist/compiler/index.js"
}
```

Run: `npm install && npm test --workspace @woven-deep/content -- parse-file.test.ts`

Expected: FAIL because compiler exports do not exist.

- [ ] **Step 3: Implement structured errors and strict schemas**

```ts
// packages/content/src/compiler/error.ts
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
```

```ts
// packages/content/src/compiler/schema.ts
import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
const glyph = z.string().refine((value) => [...value].length === 1, 'must be one Unicode glyph');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const common = {
  id,
  name: z.string().trim().min(1).max(80),
  glyph,
  color,
  tags: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).default([]),
};

export const contentEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('monster'),
    ai: id,
    runAppearanceChance: z.number().min(0).max(1).default(1),
    stats: z.object({
      health: z.number().int().positive(),
      attack: z.number().int().nonnegative(),
      defense: z.number().int().nonnegative(),
    }).strict(),
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('item'),
    effect: id,
    price: z.number().int().nonnegative(),
  }).strict(),
]);

export const contentFileSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(contentEntrySchema).min(1),
}).strict();
```

- [ ] **Step 4: Implement bounded safe parsing**

```ts
// packages/content/src/compiler/parse-file.ts
import { parseDocument } from 'yaml';
import type { ContentEntry } from '../model.js';
import { ContentCompileError } from './error.js';
import { contentFileSchema } from './schema.js';

const MAX_FILE_BYTES = 256 * 1024;

export function parseContentFile(input: { path: string; source: string }): readonly ContentEntry[] {
  if (Buffer.byteLength(input.source, 'utf8') > MAX_FILE_BYTES) {
    throw new ContentCompileError([{ file: input.path, path: '$', message: 'file exceeds 262144 bytes' }]);
  }

  const document = parseDocument(input.source, {
    schema: 'core',
    customTags: [],
    prettyErrors: false,
  });
  if (document.errors.length > 0) {
    throw new ContentCompileError(document.errors.map((error) => ({
      file: input.path,
      path: '$',
      message: error.message,
    })));
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ContentCompileError([{
      file: input.path,
      path: '$',
      message: error instanceof Error ? error.message : 'unsafe YAML alias',
    }]);
  }
  const result = contentFileSchema.safeParse(value);
  if (!result.success) {
    throw new ContentCompileError(result.error.issues.map((issue) => ({
      file: input.path,
      path: issue.path.length === 0 ? '$' : `$.${issue.path.join('.')}`,
      message: issue.message,
    })));
  }
  return result.data.entries;
}
```

```ts
// packages/content/src/compiler/index.ts
export * from './error.js';
export * from './parse-file.js';
```

Keep `packages/content/src/index.ts` browser-safe. Server code imports compiler functions from `@woven-deep/content/compiler`; browser code imports models from `@woven-deep/content`.

- [ ] **Step 5: Run parser tests and commit**

Run: `npm test --workspace @woven-deep/content -- parse-file.test.ts`

Expected: three passing tests.

```bash
git add package.json package-lock.json packages/content
git commit -m "feat: parse strict YAML content"
```

---

### Task 3: Compile, validate, and hash a content directory

**Files:**
- Create: `packages/content/src/compiler/stable-json.ts`
- Create: `packages/content/src/compiler/compile-directory.ts`
- Modify: `packages/content/src/compiler/index.ts`
- Test: `packages/content/test/compile-directory.test.ts`

**Interfaces:**
- Produces: `ContentRegistries { ai: ReadonlySet<string>; effects: ReadonlySet<string> }`
- Produces: `compileContentDirectory(input: { rootDir: string; registries: ContentRegistries }): Promise<CompiledContentPack>`
- Produces: lowercase SHA-256 content hashes

- [ ] **Step 1: Write deterministic compilation tests**

```ts
// packages/content/test/compile-directory.test.ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory, ContentCompileError } from '../src/compiler/index.js';

const registries = {
  ai: new Set(['ai.skittish']),
  effects: new Set(['effect.light-source']),
};

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-'));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

describe('compileContentDirectory', () => {
  it('produces the same hash regardless of YAML formatting and filenames', async () => {
    const compact = await fixture({
      'z.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.skittish, stats: {health: 4, attack: 2, defense: 0}}, {kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", effect: effect.light-source, price: 4}]\n',
    });
    const expanded = await fixture({
      'nested/a.yml': 'schemaVersion: 1\nentries:\n  - kind: monster\n    id: monster.rat\n    name: Rat\n    glyph: r\n    color: "#aaaaaa"\n    ai: ai.skittish\n    stats:\n      health: 4\n      attack: 2\n      defense: 0\n  - kind: item\n    id: item.lantern\n    name: Lantern\n    glyph: "¤"\n    color: "#eeeeaa"\n    effect: effect.light-source\n    price: 4\n',
    });

    const left = await compileContentDirectory({ rootDir: compact, registries });
    const right = await compileContentDirectory({ rootDir: expanded, registries });
    expect(left.hash).toBe(right.hash);
  });

  it('rejects duplicates and unregistered behaviors', async () => {
    const root = await fixture({
      'a.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", ai: ai.unknown, stats: {health: 4, attack: 2, defense: 0}}]\n',
      'b.yaml': 'schemaVersion: 1\nentries: [{kind: monster, id: monster.rat, name: Rat Two, glyph: R, color: "#bbbbbb", ai: ai.skittish, stats: {health: 5, attack: 2, defense: 0}}]\n',
    });
    await expect(compileContentDirectory({ rootDir: root, registries })).rejects.toBeInstanceOf(ContentCompileError);
  });
});
```

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npm test --workspace @woven-deep/content -- compile-directory.test.ts`

Expected: FAIL because `compileContentDirectory` is not exported.

- [ ] **Step 3: Implement stable serialization**

```ts
// packages/content/src/compiler/stable-json.ts
import { createHash } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function stableJsonHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
```

- [ ] **Step 4: Implement deterministic discovery and semantic validation**

```ts
// packages/content/src/compiler/compile-directory.ts
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CompiledContentPack, ContentEntry } from '../model.js';
import { CONTENT_SCHEMA_VERSION } from '../model.js';
import { stableJsonHash } from './stable-json.js';
import { ContentCompileError, type ContentCompileIssue } from './error.js';
import { parseContentFile } from './parse-file.js';

export interface ContentRegistries {
  readonly ai: ReadonlySet<string>;
  readonly effects: ReadonlySet<string>;
}

async function yamlPaths(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) found.push(...await yamlPaths(root, path));
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) found.push(path);
  }
  return found.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

export async function compileContentDirectory(input: {
  rootDir: string;
  registries: ContentRegistries;
}): Promise<CompiledContentPack> {
  const entries: ContentEntry[] = [];
  const issues: ContentCompileIssue[] = [];
  const seen = new Map<string, string>();

  for (const absolutePath of await yamlPaths(input.rootDir)) {
    const file = relative(input.rootDir, absolutePath);
    for (const entry of parseContentFile({ path: file, source: await readFile(absolutePath, 'utf8') })) {
      const firstFile = seen.get(entry.id);
      if (firstFile) issues.push({ file, path: '$.entries.id', message: `duplicate ${entry.id}; first declared in ${firstFile}` });
      else seen.set(entry.id, file);
      if (entry.kind === 'monster' && !input.registries.ai.has(entry.ai)) {
        issues.push({ file, path: `$.entries.${entry.id}.ai`, message: `unregistered AI ${entry.ai}` });
      }
      if (entry.kind === 'item' && !input.registries.effects.has(entry.effect)) {
        issues.push({ file, path: `$.entries.${entry.id}.effect`, message: `unregistered effect ${entry.effect}` });
      }
      entries.push(entry);
    }
  }

  if (entries.length === 0) issues.push({ file: input.rootDir, path: '$', message: 'content directory contains no YAML entries' });
  for (const requiredKind of ['monster', 'item'] as const) {
    if (!entries.some((entry) => entry.kind === requiredKind)) {
      issues.push({ file: input.rootDir, path: '$.entries', message: `missing foundational ${requiredKind} content` });
    }
  }
  if (issues.length > 0) throw new ContentCompileError(issues);
  entries.sort((left, right) => left.id.localeCompare(right.id));
  const hashInput = { schemaVersion: CONTENT_SCHEMA_VERSION, entries };
  return { ...hashInput, hash: stableJsonHash(hashInput) };
}
```

Replace `packages/content/src/compiler/index.ts` with:

```ts
export * from './stable-json.js';
export * from './compile-directory.js';
export * from './error.js';
export * from './parse-file.js';
```

- [ ] **Step 5: Run all content tests and commit**

Run: `npm test --workspace @woven-deep/content && npm run typecheck --workspace @woven-deep/content`

Expected: all tests pass and typecheck reports no errors.

```bash
git add packages/content
git commit -m "feat: compile deterministic content packs"
```

---

### Task 4: Add editable content and a validation command

**Files:**
- Create: `content/monsters/cave-rat.yaml`
- Create: `content/items/brass-lantern.yaml`
- Create: `packages/content/src/cli.ts`
- Modify: `packages/content/package.json`
- Modify: `package.json`
- Test: `packages/content/test/default-content.test.ts`

**Interfaces:**
- Consumes: `compileContentDirectory`
- Produces: `npm run content:validate`
- Produces: initial content IDs `monster.cave-rat` and `item.brass-lantern`

- [ ] **Step 1: Write a failing default-content test**

```ts
// packages/content/test/default-content.test.ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('bundled content', () => {
  it('compiles foundational monster and light entries', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
      registries: {
        ai: new Set(['ai.skittish']),
        effects: new Set(['effect.light-source']),
      },
    });
    expect(pack.entries.map((entry) => entry.id)).toEqual([
      'item.brass-lantern',
      'monster.cave-rat',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify missing content failure**

Run: `npm test --workspace @woven-deep/content -- default-content.test.ts`

Expected: FAIL because `content/` does not exist or contains no YAML entries.

- [ ] **Step 3: Add initial editable YAML**

```yaml
# content/monsters/cave-rat.yaml
schemaVersion: 1
entries:
  - kind: monster
    id: monster.cave-rat
    name: Cave rat
    glyph: r
    color: "#9e927c"
    tags: [animal, darkness]
    ai: ai.skittish
    runAppearanceChance: 1
    stats:
      health: 4
      attack: 2
      defense: 0
```

```yaml
# content/items/brass-lantern.yaml
schemaVersion: 1
entries:
  - kind: item
    id: item.brass-lantern
    name: Brass lantern
    glyph: "¤"
    color: "#e8c879"
    tags: [light, utility]
    effect: effect.light-source
    price: 24
```

- [ ] **Step 4: Add the validation CLI**

```ts
// packages/content/src/cli.ts
import { resolve } from 'node:path';
import { compileContentDirectory } from './compiler/index.js';

const rootDir = resolve(process.argv[2] ?? 'content');
const pack = await compileContentDirectory({
  rootDir,
  registries: {
    ai: new Set(['ai.skittish']),
    effects: new Set(['effect.light-source']),
  },
});
process.stdout.write(`${pack.hash} ${pack.entries.length} entries\n`);
```

Add this exact root script; the existing `src/**/*.ts` include compiles `cli.ts`:

```json
"content:validate": "npm run build --workspace @woven-deep/content && node packages/content/dist/cli.js"
```

- [ ] **Step 5: Verify content and commit**

Run: `npm run content:validate`

Expected: exit code 0 and output matching `^[a-f0-9]{64} 2 entries$`.

```bash
git add content packages/content package.json package-lock.json
git commit -m "feat: add editable default content"
```

---

### Task 5: Persist the startup content pack in SQLite

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/database.ts`
- Create: `apps/server/src/content-repository.ts`
- Create: `apps/server/src/content-bootstrap.ts`
- Test: `apps/server/test/content-repository.test.ts`
- Test: `apps/server/test/content-bootstrap.test.ts`

**Interfaces:**
- Produces: `ServerConfig { host; port; databasePath; contentDir; webDistDir }`
- Produces: `openDatabase(path: string): Database.Database`
- Produces: `ContentPackRepository.put(pack)` and `.get(hash)`
- Produces: `bootstrapContent(contentDir: string, repository: ContentPackRepository): Promise<CompiledContentPack>`

- [ ] **Step 1: Write repository and bootstrap tests**

```ts
// apps/server/test/content-repository.test.ts
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/database.js';
import { ContentPackRepository } from '../src/content-repository.js';

describe('ContentPackRepository', () => {
  it('deduplicates immutable packs by hash', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    const repository = new ContentPackRepository(database);
    const pack = { schemaVersion: 1 as const, hash: 'a'.repeat(64), entries: [] };
    repository.put(pack);
    repository.put(pack);
    expect(repository.get(pack.hash)).toEqual(pack);
    expect(database.prepare('select count(*) as count from content_packs').get()).toEqual({ count: 1 });
  });
});
```

```ts
// apps/server/test/content-bootstrap.test.ts
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapContent } from '../src/content-bootstrap.js';
import { ContentPackRepository } from '../src/content-repository.js';
import { migrateDatabase } from '../src/database.js';

it('compiles and stores the configured content directory', async () => {
  const database = new Database(':memory:');
  migrateDatabase(database);
  const repository = new ContentPackRepository(database);
  const pack = await bootstrapContent(resolve(import.meta.dirname, '../../../content'), repository);
  expect(repository.get(pack.hash)?.entries).toHaveLength(2);
});
```

- [ ] **Step 2: Create the server package and verify failure**

```json
// apps/server/package.json
{
  "name": "@woven-deep/server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@woven-deep/content": "0.0.0",
    "better-sqlite3": "^12.0.0",
    "fastify": "^5.4.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

```json
// apps/server/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

At this point, replace the root orchestration scripts so a clean checkout builds the content package before server tests or compilation:

```json
"scripts": {
  "build": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/server",
  "content:validate": "npm run build --workspace @woven-deep/content && node packages/content/dist/cli.js",
  "test": "npm run build --workspace @woven-deep/content && npm run test --workspaces --if-present",
  "typecheck": "npm run build --workspace @woven-deep/content && npm run typecheck --workspaces --if-present"
}
```

Run: `npm install && npm test --workspace @woven-deep/server`

Expected: FAIL because server modules do not exist.

- [ ] **Step 3: Implement configuration and migrations**

```ts
// apps/server/src/config.ts
import { resolve } from 'node:path';

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly contentDir: string;
  readonly webDistDir: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databasePath: resolve(env.DATABASE_PATH ?? 'data/rogue.sqlite'),
    contentDir: resolve(env.CONTENT_DIR ?? 'content'),
    webDistDir: resolve(env.WEB_DIST_DIR ?? 'apps/web/dist'),
  };
}
```

`data/rogue.sqlite` is the local-development default. The production Docker environment in Task 8 explicitly sets `DATABASE_PATH=/data/rogue.sqlite`; tests must cover both values.

```ts
// apps/server/src/database.ts
import Database from 'better-sqlite3';

export function migrateDatabase(database: Database.Database): void {
  database.pragma('journal_mode = WAL');
  database.exec(`
    create table if not exists content_packs (
      hash text primary key check(length(hash) = 64),
      schema_version integer not null,
      content_json text not null,
      created_at text not null
    ) strict;
  `);
}

export function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  migrateDatabase(database);
  return database;
}
```

- [ ] **Step 4: Implement immutable content storage and startup compilation**

```ts
// apps/server/src/content-repository.ts
import type Database from 'better-sqlite3';
import type { CompiledContentPack } from '@woven-deep/content';

export class ContentPackRepository {
  constructor(private readonly database: Database.Database) {}

  put(pack: CompiledContentPack): void {
    this.database.prepare(`
      insert into content_packs(hash, schema_version, content_json, created_at)
      values (?, ?, ?, ?)
      on conflict(hash) do nothing
    `).run(pack.hash, pack.schemaVersion, JSON.stringify(pack), new Date().toISOString());
  }

  get(hash: string): CompiledContentPack | undefined {
    const row = this.database.prepare('select content_json from content_packs where hash = ?')
      .get(hash) as { content_json: string } | undefined;
    return row ? JSON.parse(row.content_json) as CompiledContentPack : undefined;
  }
}
```

```ts
// apps/server/src/content-bootstrap.ts
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { ContentPackRepository } from './content-repository.js';

export async function bootstrapContent(
  contentDir: string,
  repository: ContentPackRepository,
): Promise<CompiledContentPack> {
  const pack = await compileContentDirectory({
    rootDir: contentDir,
    registries: {
      ai: new Set(['ai.skittish']),
      effects: new Set(['effect.light-source']),
    },
  });
  repository.put(pack);
  return pack;
}
```

- [ ] **Step 5: Run server tests and commit**

Run: `npm test --workspace @woven-deep/server && npm run typecheck --workspace @woven-deep/server`

Expected: two passing tests and zero TypeScript errors.

```bash
git add apps/server package.json package-lock.json
git commit -m "feat: persist immutable content packs"
```

---

### Task 6: Serve health and guest-content APIs

**Files:**
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/main.ts`
- Modify: `apps/server/package.json`
- Test: `apps/server/test/app.test.ts`

**Interfaces:**
- Produces: `buildApp(input: { pack: CompiledContentPack }): FastifyInstance`
- Produces: `GET /api/health -> { status: 'ok'; contentHash: string; entries: number }`
- Produces: `GET /api/content/guest -> CompiledContentPack`

- [ ] **Step 1: Write failing route tests**

```ts
// apps/server/test/app.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const pack = { schemaVersion: 1 as const, hash: 'b'.repeat(64), entries: [] };

describe('content API', () => {
  it('reports readiness and serves the guest pack', async () => {
    const app = buildApp({ pack });
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ status: 'ok', contentHash: pack.hash, entries: 0 });
    const content = await app.inject({ method: 'GET', url: '/api/content/guest' });
    expect(content.json()).toEqual(pack);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the route test to verify failure**

Run: `npm test --workspace @woven-deep/server -- app.test.ts`

Expected: FAIL because `buildApp` does not exist.

- [ ] **Step 3: Implement the Fastify application and process entrypoint**

```ts
// apps/server/src/app.ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';

export function buildApp(input: { pack: CompiledContentPack }): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({
    status: 'ok' as const,
    contentHash: input.pack.hash,
    entries: input.pack.entries.length,
  }));
  app.get('/api/content/guest', async () => input.pack);
  return app;
}
```

```ts
// apps/server/src/main.ts
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { bootstrapContent } from './content-bootstrap.js';
import { ContentPackRepository } from './content-repository.js';
import { readConfig } from './config.js';
import { openDatabase } from './database.js';

const config = readConfig();
await mkdir(dirname(config.databasePath), { recursive: true });
const database = openDatabase(config.databasePath);
const pack = await bootstrapContent(config.contentDir, new ContentPackRepository(database));
const app = buildApp({ pack });
await app.listen({ host: config.host, port: config.port });
```

Update the server manifest with these exact fields:

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "dev": "tsx watch src/main.ts",
  "start": "node dist/main.js",
  "test": "vitest run",
  "typecheck": "tsc -p tsconfig.json --noEmit"
},
"devDependencies": {
  "@types/better-sqlite3": "^7.6.0",
  "@types/node": "^22.0.0",
  "tsx": "^4.20.0"
}
```

- [ ] **Step 4: Run tests, build, and a manual API smoke check**

Run: `npm test --workspace @woven-deep/server && npm run build --workspace @woven-deep/server`

Expected: all server tests pass and `apps/server/dist/main.js` exists.

Run in one terminal: `PORT=3100 npm start --workspace @woven-deep/server`

Run in another terminal: `curl --fail http://localhost:3100/api/health`

Expected: JSON with `status: "ok"`, a 64-character hash, and `entries: 2`.

- [ ] **Step 5: Commit**

```bash
git add apps/server package.json package-lock.json
git commit -m "feat: serve validated guest content"
```

---

### Task 7: Display the active content pack in React

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/styles.css`
- Test: `apps/web/test/App.test.tsx`
- Test: `apps/web/test/setup.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: `GET /api/health` and `GET /api/content/guest`
- Produces: `loadContentSummary(fetcher?: typeof fetch): Promise<ContentSummary>`
- Produces: server static-file fallback for the built React client

- [ ] **Step 1: Write the failing client test**

```tsx
// apps/web/test/App.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

it('shows the compiled content hash and entry counts', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', contentHash: 'c'.repeat(64), entries: 2 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 1,
      hash: 'c'.repeat(64),
      entries: [
        { id: 'monster.cave-rat', kind: 'monster', name: 'Cave rat' },
        { id: 'item.brass-lantern', kind: 'item', name: 'Brass lantern' },
      ],
    })));

  render(<App fetcher={fetcher as typeof fetch} />);
  expect(await screen.findByText('2 entries bound')).toBeVisible();
  expect(screen.getByText('1 monster')).toBeVisible();
  expect(screen.getByText('1 item')).toBeVisible();
});
```

- [ ] **Step 2: Create the web package and verify failure**

Create these exact web foundation files:

```json
// apps/web/package.json
{
  "name": "@woven-deep/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@woven-deep/content": "0.0.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.6.0",
    "jsdom": "^26.1.0",
    "vite": "^7.0.0"
  }
}
```

```json
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx", "vite.config.ts"]
}
```

```ts
// apps/web/vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
```

```html
<!-- apps/web/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>The Woven Deep</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

```ts
// apps/web/test/setup.ts
import '@testing-library/jest-dom/vitest';
```

```tsx
// apps/web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

Update the root build script to include the web package between the browser-safe content build and the server build:

```json
"build": "npm run build --workspace @woven-deep/content && npm run build --workspace @woven-deep/web && npm run build --workspace @woven-deep/server"
```

Run: `npm install && npm test --workspace @woven-deep/web`

Expected: FAIL because `App` is missing.

- [ ] **Step 3: Implement the typed API loader**

```ts
// apps/web/src/api.ts
import type { CompiledContentPack, ContentKind } from '@woven-deep/content';

export interface ContentSummary {
  readonly hash: string;
  readonly entries: number;
  readonly counts: Readonly<Record<ContentKind, number>>;
}

export async function loadContentSummary(fetcher: typeof fetch = fetch): Promise<ContentSummary> {
  const [healthResponse, packResponse] = await Promise.all([
    fetcher('/api/health'),
    fetcher('/api/content/guest'),
  ]);
  if (!healthResponse.ok || !packResponse.ok) throw new Error('The content service is unavailable.');
  const health = await healthResponse.json() as { contentHash: string; entries: number };
  const pack = await packResponse.json() as CompiledContentPack;
  if (pack.hash !== health.contentHash) throw new Error('The content service returned mismatched versions.');
  const counts = { monster: 0, item: 0 } satisfies Record<ContentKind, number>;
  for (const entry of pack.entries) counts[entry.kind] += 1;
  return { hash: pack.hash, entries: health.entries, counts };
}
```

- [ ] **Step 4: Implement the diagnostic Living Tapestry view**

```tsx
// apps/web/src/App.tsx
import { useEffect, useState } from 'react';
import { loadContentSummary, type ContentSummary } from './api.js';
import './styles.css';

export function App({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  const [summary, setSummary] = useState<ContentSummary>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void loadContentSummary(fetcher).then(setSummary, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The content service is unavailable.');
    });
  }, [fetcher]);

  return <main className="shell">
    <p className="eyebrow">The Woven Deep · foundation diagnostic</p>
    <h1>The archive is listening.</h1>
    {error && <p role="alert">{error}</p>}
    {!summary && !error && <p role="status">Binding the current content pack…</p>}
    {summary && <section className="tapestry" aria-label="Compiled content summary">
      <strong>{summary.entries} entries bound</strong>
      <span>{summary.counts.monster} monster</span>
      <span>{summary.counts.item} item</span>
      <code>{summary.hash}</code>
    </section>}
  </main>;
}
```

Use this restrained foundation stylesheet:

```css
/* apps/web/src/styles.css */
:root {
  color: #aab3d1;
  background: #121521;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
.shell { width: min(760px, calc(100% - 40px)); margin: 0 auto; padding: 12vh 0 48px; }
.eyebrow { color: #7d89a8; font-size: .75rem; letter-spacing: .14em; text-transform: uppercase; }
h1 { color: #e8c879; font-size: clamp(2rem, 7vw, 4.5rem); font-weight: 500; line-height: .95; }
.tapestry { display: grid; gap: 12px; border: 1px solid #3d465f; padding: 24px; box-shadow: inset 0 0 40px #20263a; }
.tapestry strong { color: #f1d898; font-size: 1.25rem; }
.tapestry code { overflow-wrap: anywhere; color: #7783a4; }
[role="alert"] { color: #db7f78; }
:focus-visible { outline: 2px solid #e8c879; outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
```

- [ ] **Step 5: Serve the built client from Fastify**

Add `"@fastify/static": "^8.2.0"` to server dependencies, pass `config.webDistDir` from `main.ts`, and replace `app.ts` with:

```ts
// apps/server/src/app.ts
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { CompiledContentPack } from '@woven-deep/content';

export function buildApp(input: {
  pack: CompiledContentPack;
  webDistDir?: string;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ status: 'ok' as const, contentHash: input.pack.hash, entries: input.pack.entries.length }));
  app.get('/api/content/guest', async () => input.pack);
  if (input.webDistDir) {
    void app.register(fastifyStatic, { root: input.webDistDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }
  return app;
}
```

Add this test case to `apps/server/test/app.test.ts` using a temporary directory containing `index.html`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('serves the client without shadowing API routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'woven-web-'));
  await writeFile(join(root, 'index.html'), '<div id="root"></div>');
  const app = buildApp({ pack, webDistDir: root });
  expect((await app.inject({ method: 'GET', url: '/adventure' })).body).toContain('id="root"');
  expect((await app.inject({ method: 'GET', url: '/api/missing' })).statusCode).toBe(404);
  expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ status: 'ok' });
  await app.close();
});
```

Replace the existing application construction in `apps/server/src/main.ts` with:

```ts
const app = buildApp({ pack, webDistDir: config.webDistDir });
```

- [ ] **Step 6: Run client and server verification and commit**

Run: `npm test && npm run typecheck && npm run build`

Expected: all package tests pass, type checks are clean, and web/server builds exist.

```bash
git add apps/web apps/server package.json package-lock.json
git commit -m "feat: display compiled content diagnostics"
```

---

### Task 8: Package and verify the production container

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `scripts/smoke.mjs`
- Create: `docs/operations/content-and-storage.md`
- Modify: `package.json`
- Test: production container smoke test

**Interfaces:**
- Produces: one container listening on port 3000
- Produces: persistent volume mounted at `/data`
- Produces: optional trusted content bind mount at `/app/content:ro`
- Produces: `npm run smoke -- http://localhost:3000`

- [ ] **Step 1: Write the failing smoke script**

```js
// scripts/smoke.mjs
const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const health = await fetch(`${baseUrl}/api/health`);
if (!health.ok) throw new Error(`health returned ${health.status}`);
const body = await health.json();
if (body.status !== 'ok' || !/^[a-f0-9]{64}$/.test(body.contentHash) || body.entries < 2) {
  throw new Error(`invalid health payload: ${JSON.stringify(body)}`);
}
const page = await fetch(baseUrl);
if (!page.ok || !(await page.text()).includes('<div id="root">')) {
  throw new Error('web client was not served');
}
process.stdout.write(`ok ${body.contentHash} ${body.entries} entries\n`);
```

Run: `node scripts/smoke.mjs http://localhost:3000`

Expected: FAIL with a connection error because no production container is running.

- [ ] **Step 2: Add a multi-stage production image**

```dockerfile
# Dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY content ./content
RUN npm ci
RUN npm test && npm run typecheck && npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    DATABASE_PATH=/data/rogue.sqlite CONTENT_DIR=/app/content \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/content/package.json ./packages/content/package.json
COPY --from=build /app/packages/content/dist ./packages/content/dist
COPY --from=build /app/content ./content
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "apps/server/dist/main.js"]
```

```dockerignore
# .dockerignore
.git
.superpowers
node_modules
**/dist
coverage
data
playwright-report
test-results
```

- [ ] **Step 3: Add conventional Docker Compose deployment**

```yaml
# compose.yaml
services:
  rogue:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_PATH: /data/rogue.sqlite
      CONTENT_DIR: /app/content
    volumes:
      - rogue-data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)})"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  rogue-data:
```

- [ ] **Step 4: Document content editing and safe SQLite persistence**

Write `docs/operations/content-and-storage.md` with these commands and explanations:

````markdown
# Content and storage operations

## Start and verify

```bash
docker compose up --build -d
node scripts/smoke.mjs http://localhost:3000
```

## Use reviewed mounted content

Validate the complete replacement directory before changing the container:

```bash
npm run content:validate -- /absolute/path/to/content
```

Add this service volume and keep it read-only:

```yaml
volumes:
  - /absolute/path/to/content:/app/content:ro
  - rogue-data:/data
```

Restart and verify that the reported content hash is the expected new hash:

```bash
docker compose up -d --force-recreate
node scripts/smoke.mjs http://localhost:3000
```

## Back up SQLite safely

Stop the service cleanly so SQLite checkpoints its WAL, then copy the database from the stopped container:

```bash
mkdir -p backups
docker compose stop rogue
docker compose cp rogue:/data/rogue.sqlite ./backups/rogue-$(date +%Y%m%d-%H%M%S).sqlite
docker compose start rogue
```

Never copy the database file from a running container without using SQLite's online backup API.
````

- [ ] **Step 5: Build and smoke-test the container**

Run: `docker compose up --build -d`

Expected: the `rogue` service becomes healthy.

Run: `node scripts/smoke.mjs http://localhost:3000`

Expected: `ok <64-character-hash> 2 entries`.

Run: `docker compose down`

Expected: containers stop while the named `rogue-data` volume remains.

- [ ] **Step 6: Commit**

```bash
git add .dockerignore Dockerfile compose.yaml scripts docs/operations package.json
git commit -m "build: package foundation vertical slice"
```

---

## Milestone verification

Run all of the following from the repository root:

```bash
npm ci
npm run content:validate
npm test
npm run typecheck
npm run build
docker compose up --build -d
node scripts/smoke.mjs http://localhost:3000
docker compose down
git status --short
```

Expected results:

- Content validation reports a 64-character hash and two entries.
- All package tests pass.
- All TypeScript projects type-check and build.
- The container becomes healthy and serves both API and React client.
- The smoke test reports the same active content hash as `/api/health`.
- `git status --short` prints nothing.
