# CAT-R1 Runtime Hardening

## 1. Baseline

- Repository: `MS-pesaschile-catalog-service`
- Audit used: `docs/audits/CAT-R1-runtime-endpoints-and-ec2-deployment-audit.md`
- HEAD validated before implementation: `6f49ed1f94268ff7a619a30beb932b9ac36eb41f`
- Baseline suite count from `npm test` before changes: `1767` tests across `56` test files
- Baseline commands:
  - `npm ci`: pass
  - `npm run typecheck`: pass
  - `npm run lint`: pass
  - `npm test`: fail before changes, with 6 timeout failures in HTTP/integration files
  - `npm run build`: pass

## 2. Files Modified

- Runtime:
  - `src/server.ts`
  - `src/interfaces/http/app.ts`
  - `src/shared/config.ts`
  - `src/shared/errors.ts`
  - `src/shared/readiness.ts`
  - `src/infrastructure/database/errors.ts`
  - `src/infrastructure/database/queries.ts`
  - `src/recommendationRuntime.ts`
  - `src/bootstrap.ts`
- Tests:
  - `tests/unit/http.test.ts`
  - `tests/unit/security.test.ts`
  - `tests/unit/readiness.test.ts`
  - `tests/unit/databaseQueries.test.ts`
  - `tests/unit/metricsRoute.test.ts`
  - `tests/unit/runtimeConfigHardening.test.ts`
  - `tests/unit/recommendationRuntime.test.ts`
- Operations/docs:
  - `README.md`
  - `.env.example`
  - `docs/recommendation/relationship-snapshot-offline-build.md`
  - `docs/operations/catalog-service-ec2-deployment.md`
  - `scripts/smoke-runtime.ts`
  - `package.json`

## 3. Defects Corrected

- `/health/ready` now evaluates MariaDB, Redis, and relationship snapshot independently instead of collapsing Redis failures into `database=unavailable`.
- `mysql2` infrastructure failures now map to `DATABASE_UNAVAILABLE`/HTTP `503`.
- SQL/query defects now map to `CATALOG_QUERY_FAILED`/HTTP `500` instead of generic `INTERNAL_ERROR`.
- `ENABLE_METRICS=false` now suppresses route registration for `/metrics`.
- `DB_PASSWORD` now requires a non-empty trimmed value at startup.
- Startup now logs structured snapshot load success/failure details.

## 4. Before / After

- Readiness:
  - Before: one `try/catch` could report Redis failure as database failure.
  - After: each dependency retains its own status.
- DB failures:
  - Before: raw driver failures bubbled to generic `500 INTERNAL_ERROR`.
  - After: infra outages become `503 DATABASE_UNAVAILABLE`; query defects remain `500`.
- Metrics:
  - Before: `/metrics` existed regardless of `ENABLE_METRICS`.
  - After: route exists only when metrics are enabled.
- Config:
  - Before: empty `DB_PASSWORD` passed startup validation.
  - After: empty or whitespace-only password fails fast.
- Snapshot observability:
  - Before: degraded snapshot startup only surfaced indirectly through readiness/runtime behavior.
  - After: startup emits `relationship_snapshot_loaded` or `relationship_snapshot_load_failed`.

## 5. New Tests

- Readiness independence and status-code coverage.
- DB error classification for connection refused, timeout, lost connection, SQL defect, and success.
- HTTP mapping on `GET /v1/products/search` and `GET /v1/products/:productId`.
- Metrics registration/auth combinations.
- Startup validation for `DB_PASSWORD`.
- API key precedence and explicit empty `CATALOG_API_KEYS` behavior.
- Snapshot startup observability logging.
- Exact-byte API key behavior for incoming headers.

## 6. Explicit Decisions

- SearchProducts V2 semantics were preserved:
  - missing snapshot => readiness degraded and HTTP `503`
  - loaded snapshot with zero relationships => HTTP `200` and `recommendations: []`
- Customer Profile remains degradable and does not by itself force SearchProducts V2 to `503`.
- Incoming `x-api-key` normalization was not relaxed. The runtime still requires exact bytes from callers.

## 7. Contract Changes

- No recommendation or catalog success-contract semantics were redesigned.
- Diagnostic correction only:
  - DB infrastructure failures now surface as `DATABASE_UNAVAILABLE` instead of generic `INTERNAL_ERROR`.
- `/metrics` with `ENABLE_METRICS=false` now correctly returns `404` because the route is absent.

## 8. Snapshot Reload Decision

- Final decision: `build + restart`
- Rationale:
  - no separate administrative auth boundary exists in the current HTTP surface
  - adding a reload endpoint would enlarge operational surface area
  - explicit restart is lower risk and matches current deployment tooling assumptions

## 9. Security Implications

- `/metrics` can now be removed entirely from the runtime surface.
- API key precedence and exact-byte comparison are now explicitly documented.
- No public response exposes SQL, credentials, hostnames, stack traces, or snapshot file paths.

## 10. Deployment Implications

- Operators must restart the process after publishing a new active snapshot.
- Production should use an absolute persistent `RELATIONSHIP_SNAPSHOT_DIR`.
- Readiness now gives cleaner dependency diagnosis for MariaDB vs Redis vs snapshot state.

## 11. Test Results

- Focused validation after implementation:
  - `npm run typecheck`: pass
  - targeted Vitest suites for readiness, DB mapping, metrics, config, snapshot logging, security, and representative HTTP routes: pass
- Final closing validation:
  - `npm run typecheck`: pass
  - `npm run lint`: pass
  - `npm test`: pass (`1800` tests across `61` test files)
  - `npm run build`: pass

## 12. Remaining Debt

- No dedicated internal administrative boundary exists for future runtime snapshot reloads.
- The repository still does not contain version-controlled PM2/systemd process-manager configuration.
- The runtime still depends on local filesystem snapshot publication rather than a coordinated control plane.
