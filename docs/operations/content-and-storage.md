# Content and storage operations

For the complete YAML field, registry, reference, and example guide, see [Server content configuration](../server-admin/content-configuration.md).

## Start and verify

```bash
docker compose up --build -d --wait --wait-timeout 60
node scripts/smoke.mjs http://localhost:3000
```

## Use reviewed mounted content

Validate the complete replacement directory before changing the container:

```bash
npm run content:validate -- /absolute/path/to/content
npm run content:startup-gate
npm run population:demo -- --content-dir /absolute/path/to/content
```

Add this service volume and keep it read-only:

```yaml
volumes:
  - /absolute/path/to/content:/app/content:ro
  - rogue-data:/data
```

Restart and verify that the reported content hash is the expected new hash:

```bash
docker compose up -d --force-recreate --wait --wait-timeout 60
node scripts/smoke.mjs http://localhost:3000
```

Startup compiles and cross-validates the entire schema-v3 directory before the server begins listening. A parse, schema, reference, or semantic failure aborts startup; mounted content is never partially accepted. Keep the mount read-only so the hash verified before restart remains the pack used for every new run.

## Back up SQLite safely

Stop the service cleanly so SQLite checkpoints its WAL, then copy the database from the stopped container:

```bash
mkdir -p backups
docker compose stop rogue
docker compose cp rogue:/data/rogue.sqlite ./backups/rogue-$(date +%Y%m%d-%H%M%S).sqlite
docker compose start rogue
```

Never copy the database file from a running container without using SQLite's online backup API.
