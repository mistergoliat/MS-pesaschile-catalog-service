import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';

const QUERY_TIMEOUT_MS = 15_000;
const OUTPUT_DIR = path.join('scripts', 'audits', 'customer-profile', 'outputs');
const REPO_ROOT = process.cwd();

const REPO_TERMS = [
  'master_customer',
  'customer_master',
  'customer_external_identity',
  'customer_identity',
  'customer_conversation_link',
  'customer_addresses',
  'crm_customer_onboarding',
  'ps_customer',
  'ps_address',
  'ps_orders',
  'id_customer',
  'platform_origin',
  'email',
] as const;

const IDENTITY_TABLE_CANDIDATES = [
  'master_customer',
  'customer_master',
  'customer_external_identity',
  'customer_identity',
  'customer_source_link',
  'customer_conversation_link',
  'customer_addresses',
  'crm_customer_onboarding',
] as const;

const PRESTASHOP_CORE_TABLES = ['customer', 'orders', 'order_detail', 'order_state', 'address', 'cart'] as const;

const WRITE_PRIVILEGE_PATTERNS = [
  /\bALL PRIVILEGES\b/iu,
  /\bINSERT\b/iu,
  /\bUPDATE\b/iu,
  /\bDELETE\b/iu,
  /\bCREATE\b/iu,
  /\bDROP\b/iu,
  /\bALTER\b/iu,
  /\bINDEX\b/iu,
  /\bTRIGGER\b/iu,
  /\bEVENT\b/iu,
  /\bEXECUTE\b/iu,
  /\bCREATE TEMPORARY TABLES\b/iu,
  /\bLOCK TABLES\b/iu,
  /\bFILE\b/iu,
  /\bSUPER\b/iu,
  /\bGRANT OPTION\b/iu,
];

type QueryLogEntry = {
  readonly name: string;
  readonly elapsedMs: number;
  readonly rowCount: number;
  readonly explained: boolean;
  readonly statement: string;
};

type TableRef = {
  readonly schemaName: string;
  readonly tableName: string;
};

type ColumnMeta = {
  readonly schemaName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly ordinalPosition: number;
  readonly columnType: string;
  readonly isNullable: string;
  readonly columnKey: string;
  readonly columnDefault: string | null;
  readonly extra: string;
};

type IndexMeta = {
  readonly schemaName: string;
  readonly tableName: string;
  readonly indexName: string;
  readonly nonUnique: number;
  readonly seqInIndex: number;
  readonly columnName: string;
  readonly cardinality: number | null;
  readonly indexType: string;
};

type AuditContext = {
  readonly pool: mysql.Pool;
  readonly outputDir: string;
  readonly queryLog: QueryLogEntry[];
  readonly explains: Record<string, unknown[]>;
};

type PrestashopDiscovery = {
  readonly database: string;
  readonly prefix: string;
  readonly tables: Record<(typeof PRESTASHOP_CORE_TABLES)[number], string>;
  readonly evidence: readonly Record<string, unknown>[];
};

type IdentityDiscovery = {
  readonly candidateTables: readonly TableRef[];
  readonly masterCustomerTable: TableRef | null;
  readonly sourceLinkTable: TableRef | null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3306');
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('DB_PORT must be a positive integer');
  }
  return port;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function escapeIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/gu, '``')}\``;
}

function fq(ref: TableRef): string {
  return `${escapeIdentifier(ref.schemaName)}.${escapeIdentifier(ref.tableName)}`;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function rowsAsPlain<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

function firstValue(row: RowDataPacket): unknown {
  const key = Object.keys(row)[0];
  return key ? row[key] : null;
}

function sanitizeGrant(grant: string): string {
  return grant
    .replace(/IDENTIFIED BY PASSWORD\s+'[^']*'/giu, "IDENTIFIED BY PASSWORD '[redacted]'")
    .replace(/IDENTIFIED WITH\s+\S+\s+AS\s+'[^']*'/giu, "IDENTIFIED WITH [plugin] AS '[redacted]'");
}

function dangerousGrant(grant: string): string | null {
  for (const pattern of WRITE_PRIVILEGE_PATTERNS) {
    if (pattern.test(grant)) {
      return pattern.source.replaceAll('\\b', '').replaceAll('\\', '');
    }
  }
  return null;
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql.trim().replace(/^\/\*[\s\S]*?\*\//u, '').trim();
  return /^(SELECT|SHOW|WITH|EXPLAIN)\b/iu.test(normalized);
}

function normalizeStatement(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

async function runQuery<T extends RowDataPacket[]>(
  context: AuditContext,
  name: string,
  sql: string,
  values: readonly unknown[] = [],
  options: { readonly explain?: boolean } = {},
): Promise<T> {
  if (!isReadOnlySql(sql)) {
    throw new Error(`Refusing non-read query for ${name}`);
  }

  if (options.explain) {
    const [explainRows] = await context.pool.query<RowDataPacket[]>({
      sql: `EXPLAIN FORMAT=JSON ${sql}`,
      values: [...values],
      timeout: QUERY_TIMEOUT_MS,
    });
    context.explains[name] = rowsAsPlain(explainRows);
  }

  const started = process.hrtime.bigint();
  try {
    const [rows] = await context.pool.query<T>({ sql, values: [...values], timeout: QUERY_TIMEOUT_MS });
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - started) / 1_000_000);
    context.queryLog.push({
      name,
      elapsedMs,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      explained: Boolean(options.explain),
      statement: normalizeStatement(sql),
    });
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|PROTOCOL_SEQUENCE_TIMEOUT/iu.test(message)) {
      throw new Error(`Query timeout after ${QUERY_TIMEOUT_MS}ms: ${name}`);
    }
    throw error;
  }
}

async function writeJson(context: AuditContext, filename: string, data: unknown): Promise<void> {
  await mkdir(context.outputDir, { recursive: true });
  await writeFile(path.join(context.outputDir, filename), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: requireEnv('DB_HOST'),
    port: parsePort(process.env.DB_PORT),
    user: requireEnv('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: requireEnv('DB_NAME'),
    connectionLimit: 1,
    waitForConnections: true,
    queueLimit: 0,
    decimalNumbers: true,
    timezone: 'Z',
    namedPlaceholders: false,
  });
}

async function preflight(context: AuditContext): Promise<Record<string, unknown>> {
  const selectOne = await runQuery<RowDataPacket[]>(context, 'preflight.select-1', 'SELECT 1 AS ok');
  const dbRows = await runQuery<RowDataPacket[]>(
    context,
    'preflight.database-user',
    'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, @@hostname AS serverHost',
  );
  const grantRows = await runQuery<RowDataPacket[]>(context, 'preflight.show-grants', 'SHOW GRANTS FOR CURRENT_USER()');
  const rawGrants = grantRows.map((row) => String(firstValue(row)));
  const dangerous = rawGrants
    .map((grant) => ({ grant: sanitizeGrant(grant), dangerousPrivilege: dangerousGrant(grant) }))
    .filter((item) => item.dangerousPrivilege);
  const grants = rawGrants.map(sanitizeGrant);

  const statusRows = await runQuery<RowDataPacket[]>(
    context,
    'preflight.global-status',
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running', 'Threads_connected')",
  );
  const variableRows = await runQuery<RowDataPacket[]>(
    context,
    'preflight.max-connections',
    "SHOW VARIABLES WHERE Variable_name = 'max_connections'",
  );
  const statusMap = new Map(statusRows.map((row) => [String(row.Variable_name), Number(row.Value)]));
  const maxConnections = Number(variableRows[0]?.Value ?? 0);
  const threadsRunning = statusMap.get('Threads_running') ?? 0;
  const loadRatio = maxConnections > 0 ? Number((threadsRunning / maxConnections).toFixed(4)) : null;
  const degradedLoad = threadsRunning >= 50 || (loadRatio !== null && loadRatio >= 0.7);

  const result = {
    status: dangerous.length > 0 || degradedLoad ? 'blocked' : 'ok',
    reason: dangerous.length > 0
      ? 'The configured DB user exposes write/admin privileges.'
      : degradedLoad
        ? 'Database load guardrail stopped the audit before costly queries.'
        : null,
    connection: {
      logicalHost: process.env.DB_HOST,
      configuredDatabase: process.env.DB_NAME,
      selectedDatabase: dbRows[0]?.databaseName ?? null,
      serverHost: dbRows[0]?.serverHost ?? null,
      userHash: sha256(requireEnv('DB_USER')),
      currentUserHash: sha256(String(dbRows[0]?.currentUser ?? 'unknown')),
      connectionLimit: 1,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      selectOneOk: Number(selectOne[0]?.ok) === 1,
    },
    permissionEvidence: {
      grants,
      dangerous,
    },
    loadEvidence: {
      threadsRunning,
      threadsConnected: statusMap.get('Threads_connected') ?? null,
      maxConnections,
      loadRatio,
      degradedLoad,
      guardrail: 'blocks when threadsRunning >= 50 or threadsRunning / maxConnections >= 0.7',
    },
  };

  if (dangerous.length > 0 || degradedLoad) {
    await writeJson(context, 'preflight.json', result);
    throw new Error(String(result.reason));
  }
  return result;
}

async function discoverPrestashop(context: AuditContext): Promise<PrestashopDiscovery> {
  const database = requireEnv('DB_NAME');
  const rows = await runQuery<RowDataPacket[]>(
    context,
    'discovery.prestashop-prefix',
    `
      SELECT table_name AS tableName
      FROM information_schema.tables
      WHERE table_schema = ?
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `,
    [database],
  );
  const tableNames = rows.map((row) => String(row.tableName));
  const candidates = new Map<string, Set<string>>();
  for (const tableName of tableNames) {
    for (const suffix of PRESTASHOP_CORE_TABLES) {
      if (tableName.endsWith(suffix)) {
        const prefix = tableName.slice(0, tableName.length - suffix.length);
        const set = candidates.get(prefix) ?? new Set<string>();
        set.add(suffix);
        candidates.set(prefix, set);
      }
    }
  }
  const ranked = [...candidates.entries()]
    .map(([prefix, matches]) => ({ prefix, matchedCoreTables: [...matches].sort(), matchCount: matches.size }))
    .sort((left, right) => right.matchCount - left.matchCount || left.prefix.localeCompare(right.prefix));
  const winner = ranked[0];
  if (!winner || winner.matchCount < 4) {
    throw new Error('Could not detect PrestaShop prefix from information_schema.');
  }
  const tables = Object.fromEntries(
    PRESTASHOP_CORE_TABLES.map((suffix) => [suffix, `${winner.prefix}${suffix}`]),
  ) as Record<(typeof PRESTASHOP_CORE_TABLES)[number], string>;
  return {
    database,
    prefix: winner.prefix,
    tables,
    evidence: ranked,
  };
}

async function discoverIdentityTables(context: AuditContext): Promise<IdentityDiscovery> {
  const rows = await runQuery<RowDataPacket[]>(
    context,
    'discovery.identity-tables',
    `
      SELECT table_schema AS schemaName, table_name AS tableName
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        AND table_name IN (${placeholders(IDENTITY_TABLE_CANDIDATES)})
      ORDER BY table_schema ASC, table_name ASC
    `,
    [...IDENTITY_TABLE_CANDIDATES],
  );
  const candidateTables = rowsAsPlain(rows) as TableRef[];
  const masterCustomerTable =
    candidateTables.find((item) => item.tableName === 'master_customer') ??
    candidateTables.find((item) => item.tableName === 'customer_master') ??
    null;
  const sourceLinkTable =
    candidateTables.find((item) => item.tableName === 'customer_source_link') ??
    candidateTables.find((item) => item.tableName === 'customer_external_identity') ??
    candidateTables.find((item) => item.tableName === 'customer_identity') ??
    null;
  return { candidateTables, masterCustomerTable, sourceLinkTable };
}

async function readInventory(context: AuditContext, refs: readonly TableRef[]): Promise<{
  readonly columns: readonly ColumnMeta[];
  readonly indexes: readonly IndexMeta[];
  readonly foreignKeys: readonly Record<string, unknown>[];
  readonly inferredDependents: readonly Record<string, unknown>[];
}> {
  if (refs.length === 0) {
    return { columns: [], indexes: [], foreignKeys: [], inferredDependents: [] };
  }
  const refPairs = refs.flatMap((ref) => [ref.schemaName, ref.tableName]);
  const pairPredicate = refs.map(() => '(table_schema = ? AND table_name = ?)').join(' OR ');

  const columns = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'inventory.columns',
    `
      SELECT
        table_schema AS schemaName,
        table_name AS tableName,
        column_name AS columnName,
        ordinal_position AS ordinalPosition,
        column_type AS columnType,
        is_nullable AS isNullable,
        column_key AS columnKey,
        column_default AS columnDefault,
        extra AS extra
      FROM information_schema.columns
      WHERE ${pairPredicate}
      ORDER BY table_schema ASC, table_name ASC, ordinal_position ASC
    `,
    refPairs,
  )) as ColumnMeta[];

  const indexes = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'inventory.indexes',
    `
      SELECT
        table_schema AS schemaName,
        table_name AS tableName,
        index_name AS indexName,
        non_unique AS nonUnique,
        seq_in_index AS seqInIndex,
        column_name AS columnName,
        cardinality AS cardinality,
        index_type AS indexType
      FROM information_schema.statistics
      WHERE ${pairPredicate}
      ORDER BY table_schema ASC, table_name ASC, index_name ASC, seq_in_index ASC
    `,
    refPairs,
  )) as IndexMeta[];

  const foreignKeys = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'inventory.foreign-keys',
    `
      SELECT
        table_schema AS schemaName,
        table_name AS tableName,
        column_name AS columnName,
        referenced_table_schema AS referencedSchemaName,
        referenced_table_name AS referencedTableName,
        referenced_column_name AS referencedColumnName,
        constraint_name AS constraintName
      FROM information_schema.key_column_usage
      WHERE (${pairPredicate})
        AND referenced_table_name IS NOT NULL
      ORDER BY table_schema ASC, table_name ASC, column_name ASC
    `,
    refPairs,
  )) as Record<string, unknown>[];

  const inferredDependents = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'inventory.inferred-master-dependents',
    `
      SELECT
        table_schema AS schemaName,
        table_name AS tableName,
        column_name AS columnName,
        column_key AS columnKey,
        column_type AS columnType
      FROM information_schema.columns
      WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        AND column_name IN ('master_customer_id', 'customer_master_id')
      ORDER BY table_schema ASC, table_name ASC, column_name ASC
    `,
  )) as Record<string, unknown>[];

  return { columns, indexes, foreignKeys, inferredDependents };
}

function columnsFor(columns: readonly ColumnMeta[], ref: TableRef | null): Set<string> {
  if (!ref) return new Set<string>();
  return new Set(
    columns
      .filter((column) => column.schemaName === ref.schemaName && column.tableName === ref.tableName)
      .map((column) => column.columnName),
  );
}

function chooseColumn(columns: Set<string>, candidates: readonly string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function hasUniqueIndexOn(indexes: readonly IndexMeta[], ref: TableRef, columnName: string): boolean {
  return indexes.some((index) =>
    index.schemaName === ref.schemaName &&
    index.tableName === ref.tableName &&
    index.nonUnique === 0 &&
    index.seqInIndex === 1 &&
    index.columnName === columnName,
  );
}

async function scanRepository(): Promise<Record<string, unknown>> {
  const ignoredParts = new Set(['node_modules', 'dist', '.git', 'outputs']);
  const allowedExtensions = new Set(['.ts', '.md', '.json', '.yml', '.yaml', '.sql', '.env', '.example']);
  const termHits = new Map<string, { files: Set<string>; count: number }>();
  for (const term of REPO_TERMS) {
    termHits.set(term, { files: new Set<string>(), count: 0 });
  }

  async function visit(dir: string): Promise<void> {
    const relativeDir = path.relative(REPO_ROOT, dir).replaceAll('\\', '/');
    if (
      relativeDir === 'docs/audits' ||
      relativeDir.startsWith('docs/audits/') ||
      relativeDir === 'scripts/audits' ||
      relativeDir.startsWith('scripts/audits/') ||
      relativeDir === 'scripts/customer-profile-audit' ||
      relativeDir.startsWith('scripts/customer-profile-audit/')
    ) {
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredParts.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!allowedExtensions.has(ext) && !entry.name.startsWith('.env')) continue;
      const relativePath = path.relative(REPO_ROOT, fullPath).replaceAll('\\', '/');
      const content = await readFile(fullPath, 'utf8').catch(() => '');
      for (const term of REPO_TERMS) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu');
        const matches = content.match(regex);
        if (!matches) continue;
        const hit = termHits.get(term)!;
        hit.count += matches.length;
        hit.files.add(relativePath);
      }
    }
  }

  await visit(REPO_ROOT);
  return Object.fromEntries(
    [...termHits.entries()].map(([term, hit]) => [
      term,
      {
        count: hit.count,
        files: [...hit.files].sort(),
      },
    ]),
  );
}

async function collectPrestashopBaseline(
  context: AuditContext,
  ps: PrestashopDiscovery,
): Promise<Record<string, unknown>> {
  const customer = { schemaName: ps.database, tableName: ps.tables.customer };
  const orders = { schemaName: ps.database, tableName: ps.tables.orders };
  const orderDetail = { schemaName: ps.database, tableName: ps.tables.order_detail };
  const orderState = { schemaName: ps.database, tableName: ps.tables.order_state };

  const counts = (await runQuery<RowDataPacket[]>(
    context,
    'prestashop.baseline-counts',
    `
      SELECT
        (SELECT COUNT(1) FROM ${fq(customer)}) AS prestashopCustomerCount,
        (
          SELECT COUNT(DISTINCT o.id_customer)
          FROM ${fq(orders)} o
          WHERE o.id_customer IS NOT NULL
            AND o.id_customer <> 0
        ) AS prestashopBuyerCount,
        (
          SELECT COUNT(DISTINCT LOWER(TRIM(email)))
          FROM ${fq(customer)}
          WHERE email IS NOT NULL
            AND TRIM(email) <> ''
        ) AS distinctPrestashopEmails
    `,
    [],
    { explain: true },
  ))[0] ?? {};

  const validOrders = (await runQuery<RowDataPacket[]>(
    context,
    'prestashop.valid-orders',
    `
      SELECT
        COUNT(DISTINCT o.id_order) AS validOrdersTotal,
        COUNT(DISTINCT o.id_customer) AS validOrderBuyers
      FROM ${fq(orders)} o
      INNER JOIN ${fq(orderState)} os ON os.id_order_state = o.current_state
      WHERE o.id_customer IS NOT NULL
        AND o.id_customer <> 0
        AND o.total_paid > 0
        AND os.paid = 1
        AND EXISTS (
          SELECT 1
          FROM ${fq(orderDetail)} od
          WHERE od.id_order = o.id_order
          LIMIT 1
        )
    `,
    [],
    { explain: true },
  ))[0] ?? {};

  const duplicateEmails = (await runQuery<RowDataPacket[]>(
    context,
    'prestashop.duplicate-emails',
    `
      SELECT
        COUNT(1) AS duplicateEmailsInPrestashop,
        SUM(CASE WHEN shopCount > 1 THEN 1 ELSE 0 END) AS duplicateEmailsAcrossShops
      FROM (
        SELECT
          LOWER(TRIM(email)) AS emailNorm,
          COUNT(1) AS customerRows,
          COUNT(DISTINCT id_shop) AS shopCount
        FROM ${fq(customer)}
        WHERE email IS NOT NULL
          AND TRIM(email) <> ''
        GROUP BY LOWER(TRIM(email))
        HAVING COUNT(1) > 1
      ) duplicates
    `,
    [],
    { explain: true },
  ))[0] ?? {};

  const multishop = await runQuery<RowDataPacket[]>(
    context,
    'prestashop.multishop-customer-order-counts',
    `
      SELECT
        id_shop AS shopId,
        COUNT(1) AS customers
      FROM ${fq(customer)}
      GROUP BY id_shop
      ORDER BY id_shop ASC
    `,
    [],
    { explain: true },
  );

  return {
    ...rowsAsPlain([counts])[0],
    ...rowsAsPlain([validOrders])[0],
    ...rowsAsPlain([duplicateEmails])[0],
    customersByShop: rowsAsPlain(multishop),
  };
}

async function collectMasterSchemaFacts(
  context: AuditContext,
  discovery: IdentityDiscovery,
  inventory: Awaited<ReturnType<typeof readInventory>>,
): Promise<Record<string, unknown>> {
  const master = discovery.masterCustomerTable;
  if (!master) {
    return {
      status: 'not_found',
      reason: 'No master_customer or customer_master table was visible through information_schema.',
    };
  }

  const cols = columnsFor(inventory.columns, master);
  const idColumn = chooseColumn(cols, ['id', 'master_customer_id', 'customer_id']);
  const emailColumn = chooseColumn(cols, ['email', 'primary_email', 'email_normalized', 'normalized_email']);
  const directLinkColumn = chooseColumn(cols, ['prestashop_customer_id', 'ps_customer_id', 'id_customer']);
  const platformOriginColumn = chooseColumn(cols, ['platform_origin']);

  const countRows = await runQuery<RowDataPacket[]>(
    context,
    'master.count',
    `SELECT COUNT(1) AS masterCustomerCount FROM ${fq(master)}`,
    [],
    { explain: true },
  );

  let emailFacts: Record<string, unknown> | null = null;
  if (emailColumn) {
    emailFacts = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'master.email-facts',
      `
        SELECT
          SUM(CASE WHEN ${escapeIdentifier(emailColumn)} IS NOT NULL AND TRIM(${escapeIdentifier(emailColumn)}) <> '' THEN 1 ELSE 0 END) AS rowsWithUsableEmail,
          COUNT(DISTINCT LOWER(TRIM(${escapeIdentifier(emailColumn)}))) AS distinctNormalizedEmails,
          SUM(CASE WHEN ${escapeIdentifier(emailColumn)} IS NULL OR TRIM(${escapeIdentifier(emailColumn)}) = '' THEN 1 ELSE 0 END) AS missingEmailRows,
          (
            SELECT COUNT(1)
            FROM (
              SELECT LOWER(TRIM(${escapeIdentifier(emailColumn)})) AS emailNorm
              FROM ${fq(master)}
              WHERE ${escapeIdentifier(emailColumn)} IS NOT NULL
                AND TRIM(${escapeIdentifier(emailColumn)}) <> ''
              GROUP BY LOWER(TRIM(${escapeIdentifier(emailColumn)}))
              HAVING COUNT(1) > 1
            ) duplicateMasterEmails
          ) AS duplicateEmailsInMasterCustomer
        FROM ${fq(master)}
      `,
      [],
      { explain: true },
    ))[0] ?? null;
  }

  let directLinkFacts: Record<string, unknown> | null = null;
  if (directLinkColumn) {
    directLinkFacts = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'master.direct-prestashop-link-facts',
      `
        SELECT
          COUNT(1) AS masterRows,
          SUM(CASE WHEN ${escapeIdentifier(directLinkColumn)} IS NULL OR ${escapeIdentifier(directLinkColumn)} = 0 THEN 1 ELSE 0 END) AS rowsWithoutDirectLink,
          COUNT(DISTINCT NULLIF(${escapeIdentifier(directLinkColumn)}, 0)) AS distinctDirectPrestashopCustomerIds
        FROM ${fq(master)}
      `,
      [],
      { explain: true },
    ))[0] ?? null;
  }

  let platformOriginFacts: Record<string, unknown> | null = null;
  if (platformOriginColumn) {
    platformOriginFacts = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'master.platform-origin-facts',
      `
        SELECT
          COUNT(1) AS rowsTotal,
          COUNT(DISTINCT ${escapeIdentifier(platformOriginColumn)}) AS distinctPlatformOriginValues,
          SUM(CASE WHEN ${escapeIdentifier(platformOriginColumn)} REGEXP '^[0-9]+$' THEN 1 ELSE 0 END) AS numericLookingPlatformOrigins
        FROM ${fq(master)}
      `,
      [],
      { explain: true },
    ))[0] ?? null;
  }

  return {
    status: 'found',
    table: master,
    idColumn,
    emailColumn,
    emailUnique: emailColumn ? hasUniqueIndexOn(inventory.indexes, master, emailColumn) : null,
    directLinkColumn,
    platformOriginColumn,
    masterCustomerCount: Number(countRows[0]?.masterCustomerCount ?? 0),
    emailFacts,
    directLinkFacts,
    platformOriginFacts,
    columns: inventory.columns.filter((column) => column.schemaName === master.schemaName && column.tableName === master.tableName),
    indexes: inventory.indexes.filter((index) => index.schemaName === master.schemaName && index.tableName === master.tableName),
  };
}

async function collectSourceLinkFacts(
  context: AuditContext,
  discovery: IdentityDiscovery,
  inventory: Awaited<ReturnType<typeof readInventory>>,
): Promise<Record<string, unknown>> {
  const link = discovery.sourceLinkTable;
  if (!link) {
    return {
      status: 'not_found',
      reason: 'No customer_source_link/customer_external_identity/customer_identity table was visible.',
    };
  }
  const cols = columnsFor(inventory.columns, link);
  const masterColumn = chooseColumn(cols, ['master_customer_id', 'customer_master_id', 'customer_id']);
  const sourceColumn = chooseColumn(cols, ['source_system', 'platform', 'provider', 'source']);
  const externalColumn = chooseColumn(cols, ['external_customer_id', 'external_id', 'source_customer_id', 'id_customer']);
  const rows = await runQuery<RowDataPacket[]>(
    context,
    'source-link.count',
    `SELECT COUNT(1) AS rowsTotal FROM ${fq(link)}`,
    [],
    { explain: true },
  );
  let prestashopRows: Record<string, unknown> | null = null;
  if (sourceColumn && externalColumn) {
    prestashopRows = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'source-link.prestashop-facts',
      `
        SELECT
          COUNT(1) AS sourceLinkRows,
          SUM(CASE WHEN LOWER(TRIM(${escapeIdentifier(sourceColumn)})) IN ('prestashop', 'presta_shop', 'ps') THEN 1 ELSE 0 END) AS prestashopSourceRows,
          COUNT(DISTINCT CASE WHEN LOWER(TRIM(${escapeIdentifier(sourceColumn)})) IN ('prestashop', 'presta_shop', 'ps') THEN ${escapeIdentifier(externalColumn)} END) AS distinctPrestashopExternalIds
        FROM ${fq(link)}
      `,
      [],
      { explain: true },
    ))[0] ?? null;
  }
  return {
    status: 'found',
    table: link,
    masterColumn,
    sourceColumn,
    externalColumn,
    rowCount: Number(rows[0]?.rowsTotal ?? 0),
    prestashopRows,
    columns: inventory.columns.filter((column) => column.schemaName === link.schemaName && column.tableName === link.tableName),
    indexes: inventory.indexes.filter((index) => index.schemaName === link.schemaName && index.tableName === link.tableName),
  };
}

async function collectCoverage(
  context: AuditContext,
  ps: PrestashopDiscovery,
  masterFacts: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (masterFacts.status !== 'found') {
    return {
      status: 'not_computable',
      reason: 'master_customer was not visible; exact-email coverage cannot be computed.',
    };
  }

  const master = masterFacts.table as TableRef;
  const idColumn = masterFacts.idColumn as string | null;
  const emailColumn = masterFacts.emailColumn as string | null;
  const directLinkColumn = masterFacts.directLinkColumn as string | null;
  if (!idColumn || !emailColumn) {
    return {
      status: 'not_computable',
      reason: 'master_customer lacks a detectable id or email column.',
      idColumn,
      emailColumn,
    };
  }

  const customer = { schemaName: ps.database, tableName: ps.tables.customer };
  const orders = { schemaName: ps.database, tableName: ps.tables.orders };
  const orderDetail = { schemaName: ps.database, tableName: ps.tables.order_detail };
  const orderState = { schemaName: ps.database, tableName: ps.tables.order_state };

  const directLinkProjection = directLinkColumn
    ? `, NULLIF(CAST(${escapeIdentifier(directLinkColumn)} AS UNSIGNED), 0) AS explicitPsCustomerId`
    : ', NULL AS explicitPsCustomerId';

  const coverage = (rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'coverage.email-and-order-coverage',
    `
      WITH
      master_rows AS (
        SELECT
          ${escapeIdentifier(idColumn)} AS masterId,
          LOWER(TRIM(${escapeIdentifier(emailColumn)})) AS emailNorm
          ${directLinkProjection}
        FROM ${fq(master)}
        WHERE ${escapeIdentifier(emailColumn)} IS NOT NULL
          AND TRIM(${escapeIdentifier(emailColumn)}) <> ''
      ),
      master_email_counts AS (
        SELECT emailNorm, COUNT(1) AS masterCount
        FROM master_rows
        GROUP BY emailNorm
      ),
      ps_email_counts AS (
        SELECT
          LOWER(TRIM(email)) AS emailNorm,
          COUNT(1) AS psCustomerRows,
          COUNT(DISTINCT id_customer) AS psCustomerCount
        FROM ${fq(customer)}
        WHERE email IS NOT NULL
          AND TRIM(email) <> ''
        GROUP BY LOWER(TRIM(email))
      ),
      ps_buyers AS (
        SELECT DISTINCT
          pc.id_customer AS psCustomerId,
          LOWER(TRIM(pc.email)) AS emailNorm
        FROM ${fq(orders)} o
        INNER JOIN ${fq(customer)} pc ON pc.id_customer = o.id_customer
        WHERE o.id_customer IS NOT NULL
          AND o.id_customer <> 0
          AND pc.email IS NOT NULL
          AND TRIM(pc.email) <> ''
      ),
      ps_buyers_all AS (
        SELECT DISTINCT
          o.id_customer AS psCustomerId,
          CASE
            WHEN pc.email IS NULL OR TRIM(pc.email) = '' THEN NULL
            ELSE LOWER(TRIM(pc.email))
          END AS emailNorm
        FROM ${fq(orders)} o
        LEFT JOIN ${fq(customer)} pc ON pc.id_customer = o.id_customer
        WHERE o.id_customer IS NOT NULL
          AND o.id_customer <> 0
      ),
      valid_orders AS (
        SELECT DISTINCT
          o.id_order,
          o.id_customer,
          CASE
            WHEN pc.email IS NULL OR TRIM(pc.email) = '' THEN NULL
            ELSE LOWER(TRIM(pc.email))
          END AS emailNorm
        FROM ${fq(orders)} o
        LEFT JOIN ${fq(customer)} pc ON pc.id_customer = o.id_customer
        INNER JOIN ${fq(orderState)} os ON os.id_order_state = o.current_state
        WHERE o.id_customer IS NOT NULL
          AND o.id_customer <> 0
          AND o.total_paid > 0
          AND os.paid = 1
          AND EXISTS (
            SELECT 1
            FROM ${fq(orderDetail)} od
            WHERE od.id_order = o.id_order
            LIMIT 1
          )
      )
      SELECT
        (SELECT COUNT(1) FROM ${fq(master)}) AS masterCustomerCount,
        (SELECT COUNT(1) FROM ${fq(customer)}) AS prestashopCustomerCount,
        (SELECT COUNT(DISTINCT id_customer) FROM ${fq(orders)} WHERE id_customer IS NOT NULL AND id_customer <> 0) AS prestashopBuyerCount,
        (SELECT COUNT(1) FROM master_rows mr INNER JOIN ps_email_counts pc ON pc.emailNorm = mr.emailNorm) AS masterCustomersMatchedByExactEmail,
        (SELECT COUNT(1) FROM master_rows mr INNER JOIN ps_email_counts pc ON pc.emailNorm = mr.emailNorm WHERE pc.psCustomerCount = 1) AS masterCustomersWithSinglePrestashopMatch,
        (SELECT COUNT(1) FROM master_rows mr INNER JOIN ps_email_counts pc ON pc.emailNorm = mr.emailNorm WHERE pc.psCustomerCount > 1) AS masterCustomersWithMultiplePrestashopMatches,
        (SELECT COUNT(1) FROM master_rows mr LEFT JOIN ps_email_counts pc ON pc.emailNorm = mr.emailNorm WHERE pc.emailNorm IS NULL) AS masterCustomersWithoutPrestashopMatch,
        (SELECT COUNT(DISTINCT pb.psCustomerId) FROM ps_buyers pb INNER JOIN master_email_counts mc ON mc.emailNorm = pb.emailNorm) AS prestashopBuyersMatchedToMasterCustomer,
        (SELECT COUNT(DISTINCT pba.psCustomerId) FROM ps_buyers_all pba LEFT JOIN master_email_counts mc ON mc.emailNorm = pba.emailNorm WHERE mc.emailNorm IS NULL) AS prestashopBuyersWithoutMasterCustomer,
        (SELECT COUNT(DISTINCT id_order) FROM valid_orders) AS validOrdersTotal,
        (SELECT COUNT(DISTINCT vo.id_order) FROM valid_orders vo INNER JOIN master_email_counts mc ON mc.emailNorm = vo.emailNorm) AS validOrdersLinkedToMatchedCustomers,
        (SELECT COUNT(1) FROM ps_email_counts WHERE psCustomerRows > 1) AS duplicateEmailsInPrestashop,
        (SELECT COUNT(1) FROM master_email_counts mc INNER JOIN ps_email_counts pc ON pc.emailNorm = mc.emailNorm WHERE mc.masterCount > 1 OR pc.psCustomerCount > 1) AS conflictingMatchCount,
        (SELECT COUNT(1) FROM master_rows WHERE explicitPsCustomerId IS NOT NULL) AS explicitDirectLinkRows
    `,
    [],
    { explain: true },
  ))[0] ?? {}) as Record<string, unknown>;

  const prestashopBuyerCount = Number(coverage['prestashopBuyerCount'] ?? 0);
  const prestashopBuyersMatchedToMasterCustomer = Number(coverage['prestashopBuyersMatchedToMasterCustomer'] ?? 0);
  const validOrdersTotal = Number(coverage['validOrdersTotal'] ?? 0);
  const validOrdersLinkedToMatchedCustomers = Number(coverage['validOrdersLinkedToMatchedCustomers'] ?? 0);
  const buyerCoveragePct =
    prestashopBuyerCount > 0
      ? Number(((prestashopBuyersMatchedToMasterCustomer / prestashopBuyerCount) * 100).toFixed(2))
      : null;
  const validOrderCoveragePct =
    validOrdersTotal > 0
      ? Number(((validOrdersLinkedToMatchedCustomers / validOrdersTotal) * 100).toFixed(2))
      : null;

  const resolution = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'coverage.resolution-policy-validation',
    `
      WITH
      master_rows AS (
        SELECT
          ${escapeIdentifier(idColumn)} AS masterId,
          LOWER(TRIM(${escapeIdentifier(emailColumn)})) AS emailNorm
          ${directLinkProjection}
        FROM ${fq(master)}
      ),
      ps_email_counts AS (
        SELECT
          LOWER(TRIM(email)) AS emailNorm,
          COUNT(DISTINCT id_customer) AS psCustomerCount
        FROM ${fq(customer)}
        WHERE email IS NOT NULL
          AND TRIM(email) <> ''
        GROUP BY LOWER(TRIM(email))
      )
      SELECT
        SUM(CASE WHEN explicitPsCustomerId IS NOT NULL THEN 1 ELSE 0 END) AS resolvedByExplicitLink,
        SUM(CASE WHEN explicitPsCustomerId IS NULL AND mr.emailNorm IS NOT NULL AND pc.psCustomerCount = 1 THEN 1 ELSE 0 END) AS provisionalSafeEmailBackfill,
        SUM(CASE WHEN explicitPsCustomerId IS NULL AND mr.emailNorm IS NOT NULL AND pc.psCustomerCount > 1 THEN 1 ELSE 0 END) AS conflictedByEmail,
        SUM(CASE WHEN explicitPsCustomerId IS NULL AND (mr.emailNorm IS NULL OR pc.emailNorm IS NULL) THEN 1 ELSE 0 END) AS masterCustomersWithoutPrestashopLink
      FROM master_rows mr
      LEFT JOIN ps_email_counts pc ON pc.emailNorm = mr.emailNorm
    `,
    [],
    { explain: true },
  ))[0] ?? {};

  return {
    status: 'computed',
    definitions: {
      prestashopBuyerCount: 'distinct ps_orders.id_customer values, excluding null/0',
      validOrdersTotal: 'distinct orders with id_customer, total_paid > 0, paid order state, and at least one order_detail row',
      match: 'exact LOWER(TRIM(email)) equality; no PII emitted',
    },
    ...coverage,
    buyerCoveragePct,
    validOrderCoveragePct,
    resolutionPolicyValidation: resolution,
  };
}

async function collectVariability(context: AuditContext, ps: PrestashopDiscovery): Promise<Record<string, unknown>> {
  const customer = { schemaName: ps.database, tableName: ps.tables.customer };
  const orders = { schemaName: ps.database, tableName: ps.tables.orders };
  const address = { schemaName: ps.database, tableName: ps.tables.address };

  const rows = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'variability.prestashop-account-variability',
    `
      SELECT
        (
          SELECT COUNT(1)
          FROM (
            SELECT id_customer
            FROM ${fq(address)}
            WHERE id_customer IS NOT NULL
              AND id_customer <> 0
              AND deleted = 0
            GROUP BY id_customer
            HAVING COUNT(1) > 1
          ) grouped
        ) AS accountsWithMultipleActiveAddresses,
        (
          SELECT COUNT(1)
          FROM (
            SELECT
              id_customer,
              COUNT(DISTINCT NULLIF(TRIM(REPLACE(REPLACE(phoneValue, ' ', ''), '+', '')), '')) AS phoneCount
            FROM (
              SELECT id_customer, phone AS phoneValue
              FROM ${fq(address)}
              WHERE deleted = 0
              UNION ALL
              SELECT id_customer, phone_mobile AS phoneValue
              FROM ${fq(address)}
              WHERE deleted = 0
            ) phones
            WHERE id_customer IS NOT NULL
              AND id_customer <> 0
              AND phoneValue IS NOT NULL
              AND TRIM(phoneValue) <> ''
            GROUP BY id_customer
            HAVING phoneCount > 1
          ) grouped
        ) AS accountsWithMoreThanOneObservedPhone,
        (
          SELECT COUNT(DISTINCT a.id_customer)
          FROM ${fq(address)} a
          INNER JOIN ${fq(customer)} c ON c.id_customer = a.id_customer
          WHERE a.deleted = 0
            AND (
              LOWER(TRIM(a.firstname)) <> LOWER(TRIM(c.firstname))
              OR LOWER(TRIM(a.lastname)) <> LOWER(TRIM(c.lastname))
            )
        ) AS accountsWhereAddressNameDiffersFromCustomerName,
        (
          SELECT COUNT(1)
          FROM (
            SELECT
              id_customer,
              COUNT(DISTINCT LOWER(TRIM(CONCAT(firstname, ' ', lastname)))) AS recipientCount
            FROM ${fq(address)}
            WHERE id_customer IS NOT NULL
              AND id_customer <> 0
              AND deleted = 0
            GROUP BY id_customer
            HAVING recipientCount > 1
          ) grouped
        ) AS accountsWithMultipleRecipients,
        (
          SELECT COUNT(1)
          FROM (
            SELECT DISTINCT o.id_customer
            FROM ${fq(orders)} o
            WHERE o.id_customer IS NOT NULL
              AND o.id_customer <> 0
          ) buyers
          LEFT JOIN (
            SELECT DISTINCT id_customer
            FROM ${fq(address)}
            WHERE id_customer IS NOT NULL
              AND id_customer <> 0
              AND active = 1
              AND deleted = 0
          ) active_addresses ON active_addresses.id_customer = buyers.id_customer
          WHERE active_addresses.id_customer IS NULL
        ) AS buyersWithOrdersButNoActiveAddress,
        (
          SELECT SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END)
          FROM ${fq(customer)}
        ) AS deletedPrestashopCustomers,
        (
          SELECT COUNT(1)
          FROM ${fq(orders)} o
          LEFT JOIN ${fq(customer)} c ON c.id_customer = o.id_customer
          WHERE o.id_customer IS NULL
            OR o.id_customer = 0
            OR c.id_customer IS NULL
        ) AS ordersWithMissingOrInvalidCustomer,
        (
          SELECT COUNT(1)
          FROM (
            SELECT LOWER(TRIM(email)) AS emailNorm, id_shop
            FROM ${fq(customer)}
            WHERE email IS NOT NULL
              AND TRIM(email) <> ''
            GROUP BY LOWER(TRIM(email)), id_shop
            HAVING COUNT(1) > 1
          ) grouped
        ) AS duplicateEmailsWithinSameShop,
        (
          SELECT COUNT(1)
          FROM (
            SELECT LOWER(TRIM(email)) AS emailNorm
            FROM ${fq(customer)}
            WHERE email IS NOT NULL
              AND TRIM(email) <> ''
            GROUP BY LOWER(TRIM(email))
            HAVING COUNT(DISTINCT id_shop) > 1
          ) grouped
        ) AS duplicateEmailsAcrossMultipleShops,
        (
          SELECT COUNT(1)
          FROM (
            SELECT id_customer
            FROM ${fq(orders)}
            WHERE id_customer IS NOT NULL
              AND id_customer <> 0
            GROUP BY id_customer
            HAVING COUNT(DISTINCT id_shop) > 1
          ) grouped
        ) AS accountsWithOrdersInMoreThanOneShop
    `,
    [],
    { explain: true },
  ))[0] ?? {};

  return rows;
}

async function run(): Promise<void> {
  const context: AuditContext = {
    pool: createPool(),
    outputDir: OUTPUT_DIR,
    queryLog: [],
    explains: {},
  };
  await mkdir(context.outputDir, { recursive: true });
  for (const filename of [
    'audit-result.json',
    'error.json',
    'explains.json',
    'preflight.json',
    'query-log.json',
    'repository-scan.json',
  ]) {
    await rm(path.join(context.outputDir, filename), { force: true });
  }

  try {
    const repositoryScan = await scanRepository();
    await writeJson(context, 'repository-scan.json', repositoryScan);

    const preflightResult = await preflight(context);
    await writeJson(context, 'preflight.json', preflightResult);

    const prestashop = await discoverPrestashop(context);
    const identity = await discoverIdentityTables(context);
    const tableRefs: TableRef[] = [
      ...Object.values(prestashop.tables).map((tableName) => ({ schemaName: prestashop.database, tableName })),
      ...identity.candidateTables,
    ];
    const uniqueRefs = [...new Map(tableRefs.map((ref) => [`${ref.schemaName}.${ref.tableName}`, ref])).values()];
    const inventory = await readInventory(context, uniqueRefs);
    const prestashopBaseline = await collectPrestashopBaseline(context, prestashop);
    const masterFacts = await collectMasterSchemaFacts(context, identity, inventory);
    const sourceLinkFacts = await collectSourceLinkFacts(context, identity, inventory);
    const coverage = await collectCoverage(context, prestashop, masterFacts);
    const variability = await collectVariability(context, prestashop);

    const result = {
      generatedAt: new Date().toISOString(),
      scope: 'CP-R1-T01 Customer Account and Identity Foundation Audit',
      preflight: preflightResult,
      repositoryScan,
      discovery: {
        prestashop,
        identity,
      },
      inventory,
      prestashopBaseline,
      masterCustomer: masterFacts,
      sourceLink: sourceLinkFacts,
      coverage,
      variability,
      assumptions: [
        'PrestaShop prefix is detected from information_schema, not from PRESTASHOP_DB_PREFIX.',
        'Exact email matching uses LOWER(TRIM(email)) and emits only aggregate counts.',
        'validOrdersTotal is preliminary: paid order state, total_paid > 0, id_customer present, and at least one order_detail row.',
        'No Customer Profile production code, endpoints, migrations, CRM writes, PrestaShop writes, or data modifications are performed.',
      ],
    };

    await writeJson(context, 'audit-result.json', result);
    await writeJson(context, 'explains.json', context.explains);
    await writeJson(context, 'query-log.json', context.queryLog);
  } catch (error) {
    await writeJson(context, 'error.json', {
      generatedAt: new Date().toISOString(),
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    await writeJson(context, 'explains.json', context.explains);
    await writeJson(context, 'query-log.json', context.queryLog);
    throw error;
  } finally {
    await context.pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
