# Catalog Service EC2 Deployment

This runbook is the stable operational counterpart of the CAT-R1 runtime audit.

## First deploy

```bash
git clone <repo-url> catalog-service
cd catalog-service
npm ci
cp .env.example .env
# edit .env with DB_*, API_KEY or CATALOG_API_KEYS, and a persistent RELATIONSHIP_SNAPSHOT_DIR
npm run build
npm run relationship:snapshot:build
npm start
```

Validate immediately after startup:

```bash
curl -s http://127.0.0.1:4010/health/ready
npm run smoke -- --base-url=http://127.0.0.1:4010 --api-key=<catalog-api-key> --query=barra
```

Expected deployment outcome:

- `/health/live` returns `200`.
- `/health/ready` returns `200` only when MariaDB, Redis when configured, and the relationship snapshot are all ready.
- `POST /api/v2/recommendations/search-products` returns `503 COMMERCIAL_RECOMMENDATION_UNAVAILABLE` when the snapshot is not loaded. This is an operational state, not a recommendation-engine bug.

## Code deploy

```bash
git fetch origin
git pull origin main
npm ci
npm run build
# restart with your process manager
```

Before starting/restarting the production process, inject `CATALOG_SERVICE_BUILD_REF` from deployment metadata. This value is required when `NODE_ENV=production`; the service refuses to start without it. Generate it from the checkout rather than entering a SHA by hand, and persist it in the process-manager environment:

```bash
export CATALOG_SERVICE_BUILD_REF="catalog-service@$(git rev-parse HEAD)"
# Then restart the service with the process manager that owns this environment.
```

For Docker builds, pass the same generated value with `--build-arg CATALOG_SERVICE_BUILD_REF="$CATALOG_SERVICE_BUILD_REF"`. A local development process may omit it and reports `catalog-service@local`.

After restart:

```bash
curl -s http://127.0.0.1:4010/health/ready
npm run smoke -- --base-url=http://127.0.0.1:4010 --api-key=<catalog-api-key> --query=barra
```

Operational notes:

- `npm ci` is part of every deploy because `package-lock.json` is authoritative.
- `npm run build` is required because the runtime executes `dist/src/server.js`.
- This repository has no DB migrations, no schedulers, and no tracked PM2/systemd config.
- Production must provide `CATALOG_SERVICE_BUILD_REF`; the container accepts it as a build argument or runtime environment variable.

## Snapshot refresh

The final CAT-R1 decision is `build + restart`.

Why:

- The current HTTP boundary only has the shared `x-api-key` gate used by normal protected routes.
- This repository does not expose a distinct internal/admin auth surface.
- Adding a reload endpoint would enlarge the operational attack surface without a cleaner boundary.

Refresh procedure:

```bash
npm run relationship:snapshot:build
# restart the running process so T07 reloads active.json
```

Important behavior:

- Publishing a new `active.json` does not hot-reload the running process.
- If the new snapshot is invalid, the build command preserves the previous active pointer.
- After restart, startup logs emit `relationship_snapshot_loaded` on success or `relationship_snapshot_load_failed` on failure.

## Runtime files outside Git

These files must exist independently of `git pull`:

- `.env`
- `RELATIONSHIP_SNAPSHOT_DIR`

Production recommendation:

```text
RELATIONSHIP_SNAPSHOT_DIR=/absolute/persistent/path
```

Do not rely on the default relative path in production process-manager setups.
