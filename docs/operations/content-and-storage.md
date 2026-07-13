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

## Back up SQLite safely

Stop the service cleanly so SQLite checkpoints its WAL, then copy the database from the stopped container:

```bash
mkdir -p backups
docker compose stop rogue
docker compose cp rogue:/data/rogue.sqlite ./backups/rogue-$(date +%Y%m%d-%H%M%S).sqlite
docker compose start rogue
```

Never copy the database file from a running container without using SQLite's online backup API.
