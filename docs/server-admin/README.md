# Server administration

These guides cover operator-owned configuration and persistent service data:

- [Content configuration](content-configuration.md): every supported YAML entry, registry, reference, validation rule, and deployment workflow.
- [Authentication and settings roaming](authentication.md): magic-link sign-in, the auth environment variables (including the production-mandatory `PUBLIC_URL`), the dev-echo endpoint, and the enforced security properties.
- [Content and storage operations](../operations/content-and-storage.md): read-only content mounts, container verification, and SQLite backup.

Treat content changes like code changes. Validate them in staging, review the resulting content hash, mount the directory read-only, and keep the previous complete directory available for rollback.

For population content, run `npm run population:demo -- --content-dir /absolute/path/to/content` after validation. It forces every encounter model through a deterministic exit fixture without changing production probabilities in YAML. The fixture uses explicit deterministic setup at named boundaries; production `wait` commands drive relay, spawning, re-entry, and observation, while production `attack` commands cause the demonstrated leader, swarm-source, boss, Champion, and Echo defeats.
