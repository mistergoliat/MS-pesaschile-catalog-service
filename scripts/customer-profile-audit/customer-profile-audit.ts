import 'dotenv/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';

const QUERY_TIMEOUT_MS = 15_000;
const DEFAULT_OUTPUT_DIR = path.join('scripts', 'customer-profile-audit', 'outputs');

const TARGET_SUFFIXES = [
  'customer',
  'guest',
  'cart',
  'cart_product',
  'orders',
  'order_detail',
  'order_state',
  'order_state_lang',
  'order_history',
  'order_invoice',
  'order_payment',
  'product',
  'product_lang',
  'product_shop',
  'product_attribute',
  'product_attribute_shop',
  'category',
  'category_lang',
  'category_product',
  'category_shop',
  'address',
  'cart_rule',
  'cart_cart_rule',
  'order_cart_rule',
  'specific_price',
  'customer_thread',
  'customer_message',
  'message',
  'message_readed',
  'connections',
  'connections_source',
  'gender',
  'group',
  'customer_group',
  'currency',
  'shop',
  'country',
  'country_lang',
  'state',
] as const;

const CORE_SUFFIXES = ['customer', 'orders', 'order_detail', 'product', 'cart'] as const;

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
};

type ExplainLogEntry = {
  readonly name: string;
  readonly rows: readonly unknown[];
};

type TableMeta = {
  readonly tableName: string;
  readonly engine: string | null;
  readonly tableRowsEstimate: number | null;
  readonly dataLengthBytes: number | null;
  readonly indexLengthBytes: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

type ColumnMeta = {
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
  readonly database: string;
  readonly outputDir: string;
  readonly runId: string;
  readonly salt: string;
  readonly queryLog: QueryLogEntry[];
  readonly explainLog: ExplainLogEntry[];
};

type Discovery = {
  readonly allTables: readonly string[];
  readonly prefix: string;
  readonly prefixEvidence: readonly { readonly prefix: string; readonly matchedCoreTables: readonly string[]; readonly matchedTargetTables: number }[];
  readonly prefixedTables: readonly string[];
  readonly targetTablesBySuffix: Record<string, string>;
};

type Inventory = {
  readonly tables: readonly TableMeta[];
  readonly columns: readonly ColumnMeta[];
  readonly indexes: readonly IndexMeta[];
  readonly relationEvidence: {
    readonly declaredForeignKeys: readonly Record<string, unknown>[];
    readonly inferredIdColumnMatches: readonly Record<string, unknown>[];
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '3306');
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('DB_PORT must be a positive integer');
  }
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function escapeIdentifier(identifier: string): string {
  if (identifier.includes('\0')) {
    throw new Error('Invalid identifier');
  }
  return `\`${identifier.replace(/`/gu, '``')}\``;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function rowsAsPlain<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows)) as T[];
}

function getRowValue(row: RowDataPacket): unknown {
  const firstKey = Object.keys(row)[0];
  return firstKey ? row[firstKey] : null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return 0;
}

function isSelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/^\/\*[\s\S]*?\*\//u, '').trim();
  return /^SELECT\b/iu.test(trimmed) || /^WITH\b/iu.test(trimmed);
}

function dangerousGrant(grant: string): string | null {
  for (const pattern of WRITE_PRIVILEGE_PATTERNS) {
    if (pattern.test(grant)) {
      return pattern.source.replaceAll('\\b', '').replaceAll('\\', '');
    }
  }
  return null;
}

function sanitizeGrant(grant: string): string {
  return grant
    .replace(/IDENTIFIED BY PASSWORD\s+'[^']*'/giu, "IDENTIFIED BY PASSWORD '[redacted]'")
    .replace(/IDENTIFIED WITH\s+\S+\s+AS\s+'[^']*'/giu, "IDENTIFIED WITH [plugin] AS '[redacted]'");
}

function hasTable(discovery: Discovery, suffix: string): boolean {
  return Boolean(discovery.targetTablesBySuffix[suffix]);
}

function table(discovery: Discovery, suffix: string): string {
  const tableName = discovery.targetTablesBySuffix[suffix];
  if (!tableName) {
    throw new Error(`Required table suffix not discovered: ${suffix}`);
  }
  return escapeIdentifier(tableName);
}

function tableColumns(columns: readonly ColumnMeta[], tableName: string): Set<string> {
  return new Set(columns.filter((column) => column.tableName === tableName).map((column) => column.columnName));
}

async function runQuery<T extends RowDataPacket[]>(
  context: AuditContext,
  name: string,
  sql: string,
  values: readonly unknown[] = [],
  options: { readonly explain?: boolean } = {},
): Promise<T> {
  if (!isSelect(sql) && !/^SHOW\b/iu.test(sql.trim())) {
    throw new Error(`Refusing non-read query for ${name}`);
  }

  if (options.explain) {
    if (!isSelect(sql)) {
      throw new Error(`Cannot explain non-select query for ${name}`);
    }
    const [explainRows] = await context.pool.query<RowDataPacket[]>(
      { sql: `EXPLAIN FORMAT=JSON ${sql}`, values: [...values], timeout: QUERY_TIMEOUT_MS },
    );
    context.explainLog.push({ name, rows: rowsAsPlain(explainRows) });
  }

  const started = process.hrtime.bigint();
  try {
    const [rows] = await context.pool.query<T>({ sql, values: [...values], timeout: QUERY_TIMEOUT_MS });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    context.queryLog.push({
      name,
      elapsedMs: Math.round(elapsedMs),
      rowCount: Array.isArray(rows) ? rows.length : 0,
      explained: Boolean(options.explain),
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

async function preflight(context: AuditContext): Promise<{
  readonly status: 'ok' | 'blocked';
  readonly reason?: string;
  readonly connection: Record<string, unknown>;
  readonly permissionEvidence: Record<string, unknown>;
  readonly loadEvidence: Record<string, unknown>;
  readonly discovery?: Discovery;
}> {
  const pingRows = await runQuery<RowDataPacket[]>(context, 'preflight.select-1', 'SELECT 1 AS ok');
  const dbRows = await runQuery<RowDataPacket[]>(
    context,
    'preflight.current-database-user',
    'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, @@hostname AS serverHost',
  );
  const grantRows = await runQuery<RowDataPacket[]>(context, 'preflight.show-grants', 'SHOW GRANTS FOR CURRENT_USER()');
  const rawGrants = grantRows.map((row) => String(getRowValue(row)));
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
  const statusMap = new Map(statusRows.map((row) => [String(row.Variable_name), toNumber(row.Value)]));
  const maxConnections = toNumber(variableRows[0]?.Value);
  const threadsRunning = statusMap.get('Threads_running') ?? 0;
  const loadRatio = maxConnections > 0 ? threadsRunning / maxConnections : 0;
  const loadEvidence = {
    threadsRunning,
    threadsConnected: statusMap.get('Threads_connected') ?? null,
    maxConnections,
    loadRatio: Number(loadRatio.toFixed(4)),
  };

  const baseConnection = {
    logicalHost: process.env.DB_HOST,
    database: context.database,
    userHash: sha256(requireEnv('DB_USER')),
    connectionLimit: 1,
    queryTimeoutMs: QUERY_TIMEOUT_MS,
    selectOneOk: toNumber(pingRows[0]?.ok) === 1,
    serverHost: dbRows[0]?.serverHost ?? null,
    currentUserHash: sha256(String(dbRows[0]?.currentUser ?? 'unknown')),
  };

  if (dangerous.length > 0) {
    return {
      status: 'blocked',
      reason: 'DB user has write or administrative privileges; audit stopped before source reads.',
      connection: baseConnection,
      permissionEvidence: { grants, dangerous },
      loadEvidence,
    };
  }

  if ((maxConnections > 0 && loadRatio >= 0.7) || threadsRunning >= 50) {
    return {
      status: 'blocked',
      reason: 'Database load looked degraded before audit queries.',
      connection: baseConnection,
      permissionEvidence: { grants, dangerous },
      loadEvidence,
    };
  }

  const discovery = await discoverPrestashopPrefix(context);
  return {
    status: 'ok',
    connection: baseConnection,
    permissionEvidence: { grants, dangerous },
    loadEvidence,
    discovery,
  };
}

async function discoverPrestashopPrefix(context: AuditContext): Promise<Discovery> {
  const tableRows = await runQuery<RowDataPacket[]>(
    context,
    'inventory.base-tables',
    `
      SELECT table_name AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `,
  );
  const allTables = tableRows.map((row) => String(row.tableName));
  const candidates = new Map<string, Set<string>>();
  const targetCounts = new Map<string, number>();

  for (const tableName of allTables) {
    for (const suffix of TARGET_SUFFIXES) {
      if (tableName === suffix || tableName.endsWith(suffix)) {
        const prefix = tableName.slice(0, tableName.length - suffix.length);
        targetCounts.set(prefix, (targetCounts.get(prefix) ?? 0) + 1);
        if (CORE_SUFFIXES.includes(suffix as (typeof CORE_SUFFIXES)[number])) {
          const set = candidates.get(prefix) ?? new Set<string>();
          set.add(suffix);
          candidates.set(prefix, set);
        }
      }
    }
  }

  const ranked = [...targetCounts.entries()]
    .map(([prefix, matchedTargetTables]) => ({
      prefix,
      matchedCoreTables: [...(candidates.get(prefix) ?? new Set<string>())].sort(),
      matchedTargetTables,
    }))
    .sort((left, right) =>
      right.matchedCoreTables.length - left.matchedCoreTables.length ||
      right.matchedTargetTables - left.matchedTargetTables ||
      left.prefix.localeCompare(right.prefix),
    );

  const winner = ranked[0];
  if (!winner || winner.matchedCoreTables.length < 3) {
    throw new Error('Could not detect a PrestaShop table prefix from information_schema evidence.');
  }
  const tied = ranked.filter((candidate) =>
    candidate.matchedCoreTables.length === winner.matchedCoreTables.length &&
    candidate.matchedTargetTables === winner.matchedTargetTables,
  );
  if (tied.length > 1) {
    throw new Error(`Ambiguous PrestaShop table prefix candidates: ${tied.map((item) => item.prefix || '<empty>').join(', ')}`);
  }

  const targetTablesBySuffix: Record<string, string> = {};
  for (const suffix of TARGET_SUFFIXES) {
    const tableName = `${winner.prefix}${suffix}`;
    if (allTables.includes(tableName)) {
      targetTablesBySuffix[suffix] = tableName;
    }
  }

  return {
    allTables,
    prefix: winner.prefix,
    prefixEvidence: ranked.slice(0, 10),
    prefixedTables: allTables.filter((tableName) => tableName.startsWith(winner.prefix)),
    targetTablesBySuffix,
  };
}

async function readInventory(context: AuditContext, discovery: Discovery): Promise<Inventory> {
  const tableRows = await runQuery<RowDataPacket[]>(
    context,
    'inventory.tables',
    `
      SELECT
        table_name AS tableName,
        engine AS engine,
        table_rows AS tableRowsEstimate,
        data_length AS dataLengthBytes,
        index_length AS indexLengthBytes,
        create_time AS createdAt,
        update_time AS updatedAt
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders(discovery.prefixedTables)})
      ORDER BY table_name ASC
    `,
    discovery.prefixedTables,
  );

  const columnRows = await runQuery<RowDataPacket[]>(
    context,
    'inventory.columns',
    `
      SELECT
        table_name AS tableName,
        column_name AS columnName,
        ordinal_position AS ordinalPosition,
        column_type AS columnType,
        is_nullable AS isNullable,
        column_key AS columnKey,
        column_default AS columnDefault,
        extra AS extra
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders(discovery.prefixedTables)})
      ORDER BY table_name ASC, ordinal_position ASC
    `,
    discovery.prefixedTables,
  );

  const indexRows = await runQuery<RowDataPacket[]>(
    context,
    'inventory.indexes',
    `
      SELECT
        table_name AS tableName,
        index_name AS indexName,
        non_unique AS nonUnique,
        seq_in_index AS seqInIndex,
        column_name AS columnName,
        cardinality AS cardinality,
        index_type AS indexType
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders(discovery.prefixedTables)})
      ORDER BY table_name ASC, index_name ASC, seq_in_index ASC
    `,
    discovery.prefixedTables,
  );

  const fkRows = await runQuery<RowDataPacket[]>(
    context,
    'inventory.declared-foreign-keys',
    `
      SELECT
        table_name AS tableName,
        column_name AS columnName,
        referenced_table_name AS referencedTableName,
        referenced_column_name AS referencedColumnName,
        constraint_name AS constraintName
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders(discovery.prefixedTables)})
        AND referenced_table_name IS NOT NULL
      ORDER BY table_name ASC, column_name ASC
    `,
    discovery.prefixedTables,
  );

  const columns = rowsAsPlain(columnRows) as ColumnMeta[];
  const primaryIdColumns = new Map<string, string>();
  for (const column of columns) {
    if (column.columnKey === 'PRI' && /^id_/u.test(column.columnName)) {
      primaryIdColumns.set(column.columnName, column.tableName);
    }
  }
  const inferredIdColumnMatches = columns
    .filter((column) => column.columnKey !== 'PRI' && primaryIdColumns.has(column.columnName))
    .map((column) => ({
      tableName: column.tableName,
      columnName: column.columnName,
      matchedPrimaryTable: primaryIdColumns.get(column.columnName),
      evidence: 'same id_* column name as a primary key in another discovered table',
    }));

  return {
    tables: rowsAsPlain(tableRows) as TableMeta[],
    columns,
    indexes: rowsAsPlain(indexRows) as IndexMeta[],
    relationEvidence: {
      declaredForeignKeys: rowsAsPlain(fkRows) as Record<string, unknown>[],
      inferredIdColumnMatches,
    },
  };
}

function hasIndexStartingWith(indexes: readonly IndexMeta[], tableName: string, columns: readonly string[]): boolean {
  const grouped = new Map<string, IndexMeta[]>();
  for (const index of indexes.filter((item) => item.tableName === tableName)) {
    const key = `${index.tableName}:${index.indexName}`;
    grouped.set(key, [...(grouped.get(key) ?? []), index].sort((left, right) => left.seqInIndex - right.seqInIndex));
  }
  return [...grouped.values()].some((parts) =>
    columns.every((column, index) => parts[index]?.columnName === column),
  );
}

function requiredIndexChecks(discovery: Discovery, inventory: Inventory): readonly Record<string, unknown>[] {
  const checks = [
    { suffix: 'orders', columns: ['id_order'], requiredFor: 'order/detail joins' },
    { suffix: 'orders', columns: ['id_cart'], requiredFor: 'cart conversion joins' },
    { suffix: 'orders', columns: ['id_customer'], requiredFor: 'customer identity aggregation' },
    { suffix: 'order_detail', columns: ['id_order'], requiredFor: 'order line aggregation' },
    { suffix: 'order_detail', columns: ['product_id'], requiredFor: 'product affinity aggregation' },
    { suffix: 'cart', columns: ['id_cart'], requiredFor: 'cart/order joins' },
    { suffix: 'cart', columns: ['id_customer'], requiredFor: 'cart identity aggregation' },
    { suffix: 'cart', columns: ['id_guest'], requiredFor: 'guest cart aggregation' },
    { suffix: 'cart_product', columns: ['id_cart'], requiredFor: 'cart product aggregation' },
    { suffix: 'address', columns: ['id_customer'], requiredFor: 'address/customer aggregation' },
  ];
  return checks
    .filter((check) => hasTable(discovery, check.suffix))
    .map((check) => {
      const tableName = discovery.targetTablesBySuffix[check.suffix]!;
      return {
        tableName,
        columns: check.columns,
        requiredFor: check.requiredFor,
        present: hasIndexStartingWith(inventory.indexes, tableName, check.columns),
      };
    });
}

async function collectVolumes(context: AuditContext, discovery: Discovery, inventory: Inventory): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const suffix of TARGET_SUFFIXES) {
    const tableName = discovery.targetTablesBySuffix[suffix];
    if (!tableName) continue;
    const cols = tableColumns(inventory.columns, tableName);
    const dateExprs = ['date_add', 'date_upd', 'date_validity']
      .filter((column) => cols.has(column))
      .flatMap((column) => [`MIN(${escapeIdentifier(column)}) AS min_${column}`, `MAX(${escapeIdentifier(column)}) AS max_${column}`]);
    const sql = `
      SELECT
        COUNT(1) AS rowCount
        ${dateExprs.length > 0 ? `, ${dateExprs.join(', ')}` : ''}
      FROM ${escapeIdentifier(tableName)}
    `;
    const rows = await runQuery<RowDataPacket[]>(context, `volume.${suffix}`, sql, [], { explain: true });
    results[suffix] = rowsAsPlain(rows)[0] ?? {};
  }
  return results;
}

async function collectIdentity(context: AuditContext, discovery: Discovery, inventory: Inventory): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const customerTableName = discovery.targetTablesBySuffix.customer;
  const guestTableName = discovery.targetTablesBySuffix.guest;
  const cartTableName = discovery.targetTablesBySuffix.cart;
  const orderTableName = discovery.targetTablesBySuffix.orders;
  const addressTableName = discovery.targetTablesBySuffix.address;

  if (customerTableName) {
    const c = table(discovery, 'customer');
    result.customers = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.customers',
      `
        SELECT
          COUNT(1) AS customers,
          COUNT(DISTINCT id_customer) AS distinctCustomers,
          COUNT(DISTINCT NULLIF(LOWER(TRIM(email)), '')) AS distinctEmails,
          SUM(CASE WHEN NULLIF(TRIM(email), '') IS NULL THEN 1 ELSE 0 END) AS missingEmails,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS activeCustomers,
          SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deletedCustomers,
          MIN(date_add) AS firstCustomerAt,
          MAX(date_add) AS lastCustomerAt
        FROM ${c}
      `,
      [],
      { explain: true },
    ))[0];

    result.customerSamples = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.customer-samples-anonymized',
      `
        SELECT
          SHA2(CONCAT(?, CAST(id_customer AS CHAR)), 256) AS customerHash,
          CASE WHEN NULLIF(TRIM(email), '') IS NULL THEN 0 ELSE 1 END AS hasEmail,
          CASE WHEN NULLIF(TRIM(email), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, LOWER(TRIM(email))), 256) END AS emailHash,
          CASE WHEN NULLIF(TRIM(email), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, LOWER(SUBSTRING_INDEX(email, '@', -1))), 256) END AS emailDomainHash,
          CASE WHEN NULLIF(TRIM(firstname), '') IS NULL THEN 0 ELSE 1 END AS hasFirstname,
          CASE WHEN NULLIF(TRIM(lastname), '') IS NULL THEN 0 ELSE 1 END AS hasLastname,
          active,
          deleted,
          DATE(date_add) AS createdDate
        FROM ${c}
        ORDER BY id_customer DESC
        LIMIT 20
      `,
      [context.salt, context.salt, context.salt],
      { explain: true },
    ));
  }

  if (guestTableName) {
    const g = table(discovery, 'guest');
    const cols = tableColumns(inventory.columns, guestTableName);
    result.guests = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.guests',
      `
        SELECT
          COUNT(1) AS guests,
          COUNT(DISTINCT id_guest) AS distinctGuests
          ${cols.has('id_customer') ? ', COUNT(DISTINCT NULLIF(id_customer, 0)) AS guestsLinkedToCustomerIds' : ''}
          ${cols.has('date_add') ? ', MIN(date_add) AS firstGuestAt, MAX(date_add) AS lastGuestAt' : ''}
        FROM ${g}
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (cartTableName) {
    const c = table(discovery, 'cart');
    result.carts = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.carts',
      `
        SELECT
          COUNT(1) AS carts,
          COUNT(DISTINCT id_cart) AS distinctCarts,
          COUNT(DISTINCT NULLIF(id_customer, 0)) AS cartsWithCustomerIds,
          COUNT(DISTINCT NULLIF(id_guest, 0)) AS cartsWithGuestIds,
          SUM(CASE WHEN id_customer IS NULL OR id_customer = 0 THEN 1 ELSE 0 END) AS cartsWithoutCustomer,
          SUM(CASE WHEN id_guest IS NULL OR id_guest = 0 THEN 1 ELSE 0 END) AS cartsWithoutGuest,
          MIN(date_add) AS firstCartAt,
          MAX(date_add) AS lastCartAt
        FROM ${c}
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (orderTableName && customerTableName && guestTableName && cartTableName) {
    const orderCols = tableColumns(inventory.columns, orderTableName);
    const hasOrderGuest = orderCols.has('id_guest');
    const canUseOrderGuest = hasOrderGuest && hasIndexStartingWith(inventory.indexes, orderTableName, ['id_guest']);
    const guestPresenceSelect = hasOrderGuest
      ? 'SUM(CASE WHEN o.id_guest IS NULL OR o.id_guest = 0 THEN 1 ELSE 0 END) AS ordersWithoutGuest,'
      : '';
    const guestSelect = canUseOrderGuest
      ? `
          COUNT(DISTINCT NULLIF(o.id_guest, 0)) AS distinctOrderGuests,
          SUM(CASE WHEN g.id_guest IS NULL THEN 1 ELSE 0 END) AS ordersWithoutGuestRecord,`
      : '';
    const guestJoin = canUseOrderGuest
      ? `LEFT JOIN ${table(discovery, 'guest')} g ON g.id_guest = o.id_guest`
      : '';
    result.orderIdentity = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.orders-customers-guests-carts',
      `
        SELECT
          COUNT(1) AS orders,
          COUNT(DISTINCT NULLIF(o.id_customer, 0)) AS distinctOrderCustomers,
          COUNT(DISTINCT NULLIF(o.id_cart, 0)) AS distinctOrderCarts,
          SUM(CASE WHEN o.id_customer IS NULL OR o.id_customer = 0 THEN 1 ELSE 0 END) AS ordersWithoutCustomer,
          ${guestPresenceSelect}
          ${guestSelect}
          SUM(CASE WHEN c.id_customer IS NULL THEN 1 ELSE 0 END) AS ordersWithoutCustomerRecord,
          SUM(CASE WHEN ca.id_cart IS NULL THEN 1 ELSE 0 END) AS ordersWithoutCartRecord
        FROM ${table(discovery, 'orders')} o
        LEFT JOIN ${table(discovery, 'customer')} c ON c.id_customer = o.id_customer
        LEFT JOIN ${table(discovery, 'cart')} ca ON ca.id_cart = o.id_cart
        ${guestJoin}
      `,
      [],
      { explain: true },
    ))[0];
    if (!hasOrderGuest || !canUseOrderGuest) {
      result.skippedOrderGuestMetrics = [
        {
          metric: 'distinctOrderGuests/ordersWithoutGuestRecord',
          reason: hasOrderGuest
            ? 'Skipped costly guest/order aggregation because ps_orders.id_guest is not indexed.'
            : 'Skipped guest/order aggregation because ps_orders.id_guest is absent from the schema.',
        },
      ];
    }
  }

  if (addressTableName) {
    result.addresses = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.addresses',
      `
        SELECT
          COUNT(1) AS addresses,
          COUNT(DISTINCT NULLIF(id_customer, 0)) AS customersWithAddressIds,
          SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deletedAddresses,
          SUM(CASE WHEN NULLIF(TRIM(phone), '') IS NULL AND NULLIF(TRIM(phone_mobile), '') IS NULL THEN 1 ELSE 0 END) AS addressesWithoutPhone,
          SUM(CASE WHEN NULLIF(TRIM(dni), '') IS NULL THEN 1 ELSE 0 END) AS addressesWithoutDni,
          MIN(date_add) AS firstAddressAt,
          MAX(date_add) AS lastAddressAt
        FROM ${table(discovery, 'address')}
      `,
      [],
      { explain: true },
    ))[0];

    result.addressSamples = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'identity.address-samples-anonymized',
      `
        SELECT
          SHA2(CONCAT(?, CAST(id_address AS CHAR)), 256) AS addressHash,
          CASE WHEN id_customer IS NULL OR id_customer = 0 THEN NULL ELSE SHA2(CONCAT(?, CAST(id_customer AS CHAR)), 256) END AS customerHash,
          CASE WHEN NULLIF(TRIM(phone), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, TRIM(phone)), 256) END AS phoneHash,
          CASE WHEN NULLIF(TRIM(phone_mobile), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, TRIM(phone_mobile)), 256) END AS mobileHash,
          CASE WHEN NULLIF(TRIM(dni), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, TRIM(dni)), 256) END AS dniHash,
          CASE WHEN NULLIF(TRIM(address1), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, LOWER(TRIM(address1))), 256) END AS addressLineHash,
          CASE WHEN NULLIF(TRIM(city), '') IS NULL THEN NULL ELSE SHA2(CONCAT(?, LOWER(TRIM(city))), 256) END AS cityHash,
          id_country AS countryId,
          id_state AS stateId,
          deleted,
          DATE(date_add) AS createdDate
        FROM ${table(discovery, 'address')}
        ORDER BY id_address DESC
        LIMIT 20
      `,
      [context.salt, context.salt, context.salt, context.salt, context.salt, context.salt, context.salt],
      { explain: true },
    ));
  }

  return result;
}

async function collectOrders(context: AuditContext, discovery: Discovery): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  if (!hasTable(discovery, 'orders') || !hasTable(discovery, 'order_detail')) return result;

  result.orderTotals = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'orders.totals',
    `
      SELECT
        COUNT(1) AS orders,
        MIN(date_add) AS firstOrderAt,
        MAX(date_add) AS lastOrderAt,
        SUM(total_paid) AS totalPaid,
        AVG(total_paid) AS avgTotalPaid,
        SUM(CASE WHEN total_paid <= 0 THEN 1 ELSE 0 END) AS nonPositivePaidOrders
      FROM ${table(discovery, 'orders')}
    `,
    [],
    { explain: true },
  ))[0];

  result.orderStateDistribution = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'orders.state-distribution',
    `
      SELECT
        o.current_state AS stateId,
        MIN(os.paid) AS paidFlag,
        MIN(os.shipped) AS shippedFlag,
        MIN(os.delivery) AS deliveryFlag,
        MIN(os.logable) AS logableFlag,
        MIN(osl.name) AS stateLabel,
        COUNT(1) AS orders,
        SUM(o.total_paid) AS totalPaid,
        MIN(o.date_add) AS firstOrderAt,
        MAX(o.date_add) AS lastOrderAt
      FROM ${table(discovery, 'orders')} o
      LEFT JOIN ${table(discovery, 'order_state')} os ON os.id_order_state = o.current_state
      LEFT JOIN ${table(discovery, 'order_state_lang')} osl ON osl.id_order_state = o.current_state
      GROUP BY o.current_state
      ORDER BY orders DESC, stateId ASC
    `,
    [],
    { explain: true },
  ));

  result.orderDetailQuality = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'orders.detail-quality',
    `
      SELECT
        COUNT(1) AS orderLines,
        COUNT(DISTINCT od.id_order) AS ordersWithLines,
        COUNT(DISTINCT od.product_id) AS distinctProducts,
        SUM(CASE WHEN od.product_quantity IS NULL OR od.product_quantity <= 0 THEN 1 ELSE 0 END) AS nonPositiveQuantityLines,
        SUM(CASE WHEN od.product_id IS NULL OR od.product_id = 0 THEN 1 ELSE 0 END) AS missingProductLines,
        SUM(CASE WHEN p.id_product IS NULL THEN 1 ELSE 0 END) AS productRecordMissingLines,
        SUM(CASE WHEN od.total_price_tax_incl IS NULL OR od.total_price_tax_incl < 0 THEN 1 ELSE 0 END) AS negativeOrMissingLineTotals
      FROM ${table(discovery, 'order_detail')} od
      LEFT JOIN ${table(discovery, 'product')} p ON p.id_product = od.product_id
    `,
    [],
    { explain: true },
  ))[0];

  result.ordersWithoutDetails = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'orders.without-details',
    `
      SELECT COUNT(1) AS ordersWithoutDetails
      FROM ${table(discovery, 'orders')} o
      LEFT JOIN ${table(discovery, 'order_detail')} od ON od.id_order = o.id_order
      WHERE od.id_order IS NULL
    `,
    [],
    { explain: true },
  ))[0];

  result.lineCountDistribution = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'orders.line-count-distribution',
    `
      SELECT
        CASE
          WHEN lineCount = 1 THEN '1'
          WHEN lineCount BETWEEN 2 AND 3 THEN '2-3'
          WHEN lineCount BETWEEN 4 AND 10 THEN '4-10'
          ELSE '11+'
        END AS lineCountBucket,
        COUNT(1) AS orders
      FROM (
        SELECT od.id_order, COUNT(1) AS lineCount
        FROM ${table(discovery, 'order_detail')} od
        GROUP BY od.id_order
      ) grouped
      GROUP BY lineCountBucket
      ORDER BY MIN(lineCount) ASC
    `,
    [],
    { explain: true },
  ));

  return result;
}

async function collectProductsAndCategories(context: AuditContext, discovery: Discovery): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  if (hasTable(discovery, 'product')) {
    result.products = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'products.summary',
      `
        SELECT
          COUNT(1) AS products,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS activeProducts,
          SUM(CASE WHEN reference IS NULL OR TRIM(reference) = '' THEN 1 ELSE 0 END) AS productsWithoutReference,
          MIN(date_add) AS firstProductAt,
          MAX(date_add) AS lastProductAt
        FROM ${table(discovery, 'product')}
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (hasTable(discovery, 'product_lang')) {
    result.productLanguages = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'products.languages',
      `
        SELECT
          id_lang AS langId,
          id_shop AS shopId,
          COUNT(1) AS localizedRows,
          SUM(CASE WHEN name IS NULL OR TRIM(name) = '' THEN 1 ELSE 0 END) AS missingNames
        FROM ${table(discovery, 'product_lang')}
        GROUP BY id_lang, id_shop
        ORDER BY localizedRows DESC
      `,
      [],
      { explain: true },
    ));
  }

  if (hasTable(discovery, 'orders') && hasTable(discovery, 'order_detail') && hasTable(discovery, 'product_lang')) {
    result.topOrderedProducts = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'products.top-ordered',
      `
        SELECT
          od.product_id AS productId,
          MIN(pl.name) AS productName,
          COUNT(DISTINCT od.id_order) AS orders,
          SUM(od.product_quantity) AS units,
          SUM(od.total_price_tax_incl) AS totalPaid
        FROM ${table(discovery, 'order_detail')} od
        LEFT JOIN ${table(discovery, 'product_lang')} pl ON pl.id_product = od.product_id
        GROUP BY od.product_id
        ORDER BY orders DESC, units DESC
        LIMIT 20
      `,
      [],
      { explain: true },
    ));
  }

  if (hasTable(discovery, 'category') && hasTable(discovery, 'category_product')) {
    result.categories = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'categories.summary',
      `
        SELECT
          COUNT(DISTINCT c.id_category) AS categories,
          COUNT(cp.id_product) AS categoryProductLinks,
          COUNT(DISTINCT cp.id_product) AS categorizedProducts
        FROM ${table(discovery, 'category')} c
        LEFT JOIN ${table(discovery, 'category_product')} cp ON cp.id_category = c.id_category
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (hasTable(discovery, 'order_detail') && hasTable(discovery, 'category_product') && hasTable(discovery, 'category_lang')) {
    result.skippedTopOrderedCategories = [
      {
        metric: 'topOrderedCategories',
        reason: 'Skipped after the query exceeded the 15000ms timeout in a prior guarded run; build a pre-aggregated/indexed query or view later.',
      },
    ];
  }

  return result;
}

async function collectCartsAndDiscounts(
  context: AuditContext,
  discovery: Discovery,
  inventory: Inventory,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  if (hasTable(discovery, 'cart') && hasTable(discovery, 'orders')) {
    result.cartConversion = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'carts.conversion',
      `
        SELECT
          COUNT(1) AS carts,
          SUM(CASE WHEN o.id_order IS NULL THEN 0 ELSE 1 END) AS cartsWithOrder,
          SUM(CASE WHEN o.id_order IS NULL THEN 1 ELSE 0 END) AS cartsWithoutOrder,
          MIN(c.date_add) AS firstCartAt,
          MAX(c.date_add) AS lastCartAt
        FROM ${table(discovery, 'cart')} c
        LEFT JOIN ${table(discovery, 'orders')} o ON o.id_cart = c.id_cart
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (hasTable(discovery, 'cart_product')) {
    result.cartProductQuality = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'carts.product-quality',
      `
        SELECT
          COUNT(1) AS cartLines,
          COUNT(DISTINCT id_cart) AS cartsWithLines,
          COUNT(DISTINCT id_product) AS distinctProducts,
          SUM(CASE WHEN quantity IS NULL OR quantity <= 0 THEN 1 ELSE 0 END) AS nonPositiveQuantityLines,
          MIN(date_add) AS firstCartLineAt,
          MAX(date_add) AS lastCartLineAt
        FROM ${table(discovery, 'cart_product')}
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (hasTable(discovery, 'specific_price')) {
    const specificPriceTableName = discovery.targetTablesBySuffix.specific_price!;
    const specificPriceCols = tableColumns(inventory.columns, specificPriceTableName);
    const dateSelect = specificPriceCols.has('date_add')
      ? ', MIN(date_add) AS firstSpecificPriceAt, MAX(date_add) AS lastSpecificPriceAt'
      : '';
    result.specificPrices = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'discounts.specific-prices',
      `
        SELECT
          COUNT(1) AS specificPrices,
          COUNT(DISTINCT NULLIF(id_customer, 0)) AS customerSpecificPrices,
          COUNT(DISTINCT NULLIF(id_cart, 0)) AS cartSpecificPrices,
          COUNT(DISTINCT NULLIF(id_group, 0)) AS groupSpecificPrices
          ${dateSelect}
        FROM ${table(discovery, 'specific_price')}
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (hasTable(discovery, 'cart_rule')) {
    result.cartRules = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'discounts.cart-rules',
      `
        SELECT
          COUNT(1) AS cartRules,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS activeCartRules,
          MIN(date_from) AS firstRuleFrom,
          MAX(date_to) AS lastRuleTo
        FROM ${table(discovery, 'cart_rule')}
      `,
      [],
      { explain: true },
    ))[0];
  }

  if (hasTable(discovery, 'order_cart_rule')) {
    result.orderCartRules = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'discounts.order-cart-rules',
      `
        SELECT
          COUNT(1) AS orderCartRules,
          COUNT(DISTINCT id_order) AS ordersWithCartRules,
          SUM(value) AS totalDiscountValue,
          SUM(value_tax_excl) AS totalDiscountValueTaxExcl
        FROM ${table(discovery, 'order_cart_rule')}
      `,
      [],
      { explain: true },
    ))[0];
  }

  return result;
}

async function collectCustomerService(context: AuditContext, discovery: Discovery, inventory: Inventory): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const threadTableName = discovery.targetTablesBySuffix.customer_thread;
  const messageTableName = discovery.targetTablesBySuffix.customer_message;

  if (threadTableName) {
    const cols = tableColumns(inventory.columns, threadTableName);
    result.customerThreads = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'service.customer-threads',
      `
        SELECT
          COUNT(1) AS threads
          ${cols.has('id_customer') ? ', COUNT(DISTINCT NULLIF(id_customer, 0)) AS customersWithThreads' : ''}
          ${cols.has('id_order') ? ', COUNT(DISTINCT NULLIF(id_order, 0)) AS ordersWithThreads' : ''}
          ${cols.has('id_product') ? ', COUNT(DISTINCT NULLIF(id_product, 0)) AS productsWithThreads' : ''}
          ${cols.has('status') ? ', COUNT(DISTINCT NULLIF(status, "")) AS distinctStatuses' : ''}
          ${cols.has('date_add') ? ', MIN(date_add) AS firstThreadAt, MAX(date_add) AS lastThreadAt' : ''}
        FROM ${table(discovery, 'customer_thread')}
      `,
      [],
      { explain: true },
    ))[0];

    if (cols.has('status')) {
      result.customerThreadStatuses = rowsAsPlain(await runQuery<RowDataPacket[]>(
        context,
        'service.customer-thread-statuses',
        `
          SELECT status, COUNT(1) AS threads
          FROM ${table(discovery, 'customer_thread')}
          GROUP BY status
          ORDER BY threads DESC, status ASC
          LIMIT 20
        `,
        [],
        { explain: true },
      ));
    }
  }

  if (messageTableName) {
    const cols = tableColumns(inventory.columns, messageTableName);
    result.customerMessages = rowsAsPlain(await runQuery<RowDataPacket[]>(
      context,
      'service.customer-messages',
      `
        SELECT
          COUNT(1) AS messages
          ${cols.has('id_customer_thread') ? ', COUNT(DISTINCT id_customer_thread) AS threadsWithMessages' : ''}
          ${cols.has('message') ? ', AVG(CHAR_LENGTH(message)) AS avgMessageChars, MAX(CHAR_LENGTH(message)) AS maxMessageChars' : ''}
          ${cols.has('date_add') ? ', MIN(date_add) AS firstMessageAt, MAX(date_add) AS lastMessageAt' : ''}
        FROM ${table(discovery, 'customer_message')}
      `,
      [],
      { explain: true },
    ))[0];
  }

  return result;
}

async function collectCustomerTransactionalMetrics(context: AuditContext, discovery: Discovery): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  if (!hasTable(discovery, 'orders') || !hasTable(discovery, 'order_detail')) return result;

  result.customerOrderMetricCoverage = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'metrics.customer-order-coverage',
    `
      SELECT
        COUNT(1) AS customerSnapshotsPossible,
        SUM(CASE WHEN orderCount = 1 THEN 1 ELSE 0 END) AS oneOrderCustomers,
        SUM(CASE WHEN orderCount BETWEEN 2 AND 3 THEN 1 ELSE 0 END) AS twoToThreeOrderCustomers,
        SUM(CASE WHEN orderCount >= 4 THEN 1 ELSE 0 END) AS fourPlusOrderCustomers,
        MIN(firstOrderAt) AS earliestFirstOrderAt,
        MAX(lastOrderAt) AS latestLastOrderAt,
        AVG(orderCount) AS avgOrdersPerCustomer,
        AVG(totalPaid) AS avgTotalPaidPerCustomer
      FROM (
        SELECT
          o.id_customer,
          COUNT(1) AS orderCount,
          SUM(o.total_paid) AS totalPaid,
          MIN(o.date_add) AS firstOrderAt,
          MAX(o.date_add) AS lastOrderAt
        FROM ${table(discovery, 'orders')} o
        WHERE o.id_customer IS NOT NULL
          AND o.id_customer <> 0
        GROUP BY o.id_customer
      ) grouped
    `,
    [],
    { explain: true },
  ))[0];

  result.topCustomerProductAffinities = rowsAsPlain(await runQuery<RowDataPacket[]>(
    context,
    'metrics.customer-product-affinities-anonymized',
    `
      SELECT
        SHA2(CONCAT(?, CAST(o.id_customer AS CHAR)), 256) AS customerHash,
        od.product_id AS productId,
        COUNT(DISTINCT o.id_order) AS orders,
        SUM(od.product_quantity) AS units,
        MAX(o.date_add) AS lastPurchasedAt
      FROM ${table(discovery, 'orders')} o
      INNER JOIN ${table(discovery, 'order_detail')} od ON od.id_order = o.id_order
      WHERE o.id_customer IS NOT NULL
        AND o.id_customer <> 0
        AND od.product_id IS NOT NULL
        AND od.product_id <> 0
      GROUP BY o.id_customer, od.product_id
      ORDER BY orders DESC, units DESC, lastPurchasedAt DESC
      LIMIT 50
    `,
    [context.salt],
    { explain: true },
  ));

  return result;
}

async function runAudit(command: string, outputDir: string): Promise<void> {
  const context: AuditContext = {
    pool: createPool(),
    database: requireEnv('DB_NAME'),
    outputDir,
    runId: new Date().toISOString().replaceAll(':', '-'),
    salt: randomBytes(32).toString('hex'),
    queryLog: [],
    explainLog: [],
  };

  try {
    await mkdir(context.outputDir, { recursive: true });
    for (const filename of [
      'blocked.json',
      'error.json',
      'explains.json',
      'index-checks.json',
      'inventory.json',
      'preflight.json',
      'query-log.json',
      'source-audit.json',
    ]) {
      await rm(path.join(context.outputDir, filename), { force: true });
    }

    const preflightResult = await preflight(context);
    await writeJson(context, 'preflight.json', {
      generatedAt: new Date().toISOString(),
      runId: context.runId,
      ...preflightResult,
    });

    if (preflightResult.status !== 'ok' || command === 'preflight') {
      await writeJson(context, 'query-log.json', context.queryLog);
      return;
    }

    const discovery = preflightResult.discovery;
    if (!discovery) throw new Error('Discovery is missing after successful preflight.');

    const inventory = await readInventory(context, discovery);
    await writeJson(context, 'inventory.json', { generatedAt: new Date().toISOString(), discovery, inventory });

    const indexChecks = requiredIndexChecks(discovery, inventory);
    await writeJson(context, 'index-checks.json', { generatedAt: new Date().toISOString(), indexChecks });
    const missingCriticalIndexes = indexChecks.filter((check) => check.present !== true);
    if (missingCriticalIndexes.length > 0) {
      await writeJson(context, 'blocked.json', {
        generatedAt: new Date().toISOString(),
        status: 'blocked',
        reason: 'A required index for costly customer/order/cart aggregations was missing.',
        missingCriticalIndexes,
      });
      await writeJson(context, 'query-log.json', context.queryLog);
      return;
    }

    const volume = await collectVolumes(context, discovery, inventory);
    const identity = await collectIdentity(context, discovery, inventory);
    const orders = await collectOrders(context, discovery);
    const productsAndCategories = await collectProductsAndCategories(context, discovery);
    const cartsAndDiscounts = await collectCartsAndDiscounts(context, discovery, inventory);
    const customerService = await collectCustomerService(context, discovery, inventory);
    const metrics = await collectCustomerTransactionalMetrics(context, discovery);

    await writeJson(context, 'source-audit.json', {
      generatedAt: new Date().toISOString(),
      runId: context.runId,
      discovery,
      volume,
      identity,
      orders,
      productsAndCategories,
      cartsAndDiscounts,
      customerService,
      metrics,
    });
    await writeJson(context, 'explains.json', context.explainLog);
    await writeJson(context, 'query-log.json', context.queryLog);
  } catch (error) {
    await writeJson(context, 'error.json', {
      generatedAt: new Date().toISOString(),
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    await writeJson(context, 'explains.json', context.explainLog);
    await writeJson(context, 'query-log.json', context.queryLog);
    throw error;
  } finally {
    await context.pool.end();
  }
}

function getArgValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

const args = process.argv.slice(2);
const command = args[0] ?? 'run';
if (!['preflight', 'run'].includes(command)) {
  console.error('Usage: npx tsx scripts/customer-profile-audit/customer-profile-audit.ts <preflight|run> [--out <dir>]');
  process.exit(1);
}

const outputDir = getArgValue(args, '--out') ?? DEFAULT_OUTPUT_DIR;

runAudit(command, outputDir).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
