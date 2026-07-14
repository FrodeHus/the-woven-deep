# Server administration

These guides cover operator-owned configuration and persistent service data:

- [Content configuration](content-configuration.md): every supported YAML entry, registry, reference, validation rule, and deployment workflow.
- [Content and storage operations](../operations/content-and-storage.md): read-only content mounts, container verification, and SQLite backup.

Treat content changes like code changes. Validate them in staging, review the resulting content hash, mount the directory read-only, and keep the previous complete directory available for rollback.

For population content, run `npm run population:demo -- --content-dir /absolute/path/to/content` after validation. It forces every encounter model through its deterministic exit fixture without changing production probabilities in YAML.
