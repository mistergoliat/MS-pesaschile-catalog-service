# Local contract DB (R4-J1C)

A disposable MariaDB with a **synthetic** PrestaShop 1.7/8 schema subset (the tables the v2 reader
uses, with PrestaShop's real column names) and a handful of products that exercise every v2
contract case: simple, with variants, inactive, unlisted, stock unknown, backorder, an unlimited
promotion stored with zero datetimes, and the excluded internal product 444. No production data.

It exists because the v2 unit tests use fake readers: running the real `MySqlCatalogV2DataReader`
against it found three J1A defects (unknown column `fv.custom_value`, `ESCAPE '\'` syntax error,
zero-datetime promotions ignored).

```sh
docker run -d --name r4-j1c-catalog-testdb -p 127.0.0.1:33307:3306 \
  -e MARIADB_ROOT_PASSWORD=j1c-local-root -e MARIADB_DATABASE=prestashop_j1c mariadb:11.4
docker exec -i r4-j1c-catalog-testdb mariadb -uroot -pj1c-local-root prestashop_j1c < scripts/local-contract-db/ps-seed.sql
npm run build
```

Service instances used by R4's `tests/integration/catalog-http-real.test.ts` (same env for all:
`DB_HOST=127.0.0.1 DB_PORT=33307 DB_USER=catalog_reader DB_PASSWORD=j1c-local-reader-pw
DB_NAME=prestashop_j1c CATALOG_API_KEYS=<key> CACHE_DRIVER=memory ENABLE_DOCS=false`):

| Port | Override | Purpose |
|---|---|---|
| 4011 | `RATE_LIMIT_MAX=1000` | normal answers |
| 4012 | `RATE_LIMIT_MAX=3` | 429 |
| 4013 | `DB_PORT=33398` (closed) | 503 `catalog_source_unavailable` |
| 4014 | `DB_PORT=33399` + `node scripts/local-contract-db/silent-db.mjs` | hung source → consumer deadline |

Then, from the R4 repository:

```sh
R4_CATALOG_IT_BASE_URL=http://127.0.0.1:4011 R4_CATALOG_IT_API_KEY=<key> \
R4_CATALOG_IT_RATE_LIMITED_URL=http://127.0.0.1:4012 R4_CATALOG_IT_DB_DOWN_URL=http://127.0.0.1:4013 \
R4_CATALOG_IT_DB_SILENT_URL=http://127.0.0.1:4014 \
npx vitest run --project integration tests/integration/catalog-http-real.test.ts
```

Remove it with `docker rm -f r4-j1c-catalog-testdb`.
