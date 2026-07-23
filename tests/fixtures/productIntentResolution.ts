import type {
  CatalogProductIntentBatchReader,
  CatalogProductIntentSearcher,
  NormalizedProductQuery,
  ProductIntentCatalogProduct,
  ProductIntentReference,
  ProductIntentSearchHit,
  ResolveProductIntentRequest,
} from '../../src/application/catalog/product-intent/index.js';
import {
  DefaultProductClarificationBuilder,
  DefaultProductIntentCandidateRanker,
  DefaultProductIntentResolutionPolicy,
  DefaultProductIntentResolutionService,
  DefaultProductQueryNormalizer,
  StaticProductSearchSynonymProvider,
  createProductIntentIdentity,
  type ProductIntentLogger,
} from '../../src/application/catalog/product-intent/index.js';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const olympicBar15: ProductIntentCatalogProduct = {
  productId: '29',
  name: 'Barra olimpica 15 kg',
  reference: 'BAR-15',
  description: 'Barra recta para sentadillas y entrenamiento olimpico',
  category: 'Barras',
  active: true,
  price: { amount: 89990, currency: 'CLP' },
  stock: { status: 'in_stock', quantity: 8, available: true },
  attributes: [{ group: 'Peso', value: '15 kg' }],
};

export const olympicBar20: ProductIntentCatalogProduct = {
  productId: '30',
  name: 'Barra olimpica 20 kg',
  reference: 'BAR-20',
  description: 'Barra recta para sentadillas y press',
  category: 'Barras',
  active: true,
  price: { amount: 119990, currency: 'CLP' },
  stock: { status: 'in_stock', quantity: 4, available: true },
  attributes: [{ group: 'Peso', value: '20 kg' }],
};

export const hexBar: ProductIntentCatalogProduct = {
  productId: '818',
  name: 'Barra hexagonal olimpica',
  reference: 'HEX-50',
  description: 'Barra hexagonal para peso muerto',
  category: 'Barras',
  active: true,
  price: { amount: 149990, currency: 'CLP' },
  stock: { status: 'in_stock', quantity: 2, available: true },
};

export const curlBar: ProductIntentCatalogProduct = {
  productId: '325',
  name: 'Barra Z olimpica',
  reference: 'BAR-Z',
  description: 'Barra curl para brazos',
  category: 'Barras',
  active: true,
  price: { amount: 69990, currency: 'CLP' },
  stock: { status: 'in_stock', quantity: 3, available: true },
};

export const bumper20: ProductIntentCatalogProduct = {
  productId: '464',
  name: 'Disco bumper 20 kg',
  reference: 'BUM-20',
  description: 'Disco de goma olimpico rubber',
  category: 'Discos',
  active: true,
  price: { amount: 59990, currency: 'CLP' },
  stock: { status: 'in_stock', quantity: 12, available: true },
  attributes: [{ group: 'Peso', value: '20 kg' }, { group: 'Diametro', value: '50 mm' }],
};

export const kettlebell16: ProductIntentCatalogProduct = {
  productId: '700',
  combinationId: '160',
  name: 'Kettlebell 16 kg',
  reference: 'KB-16',
  description: 'Pesa rusa para entrenamiento funcional',
  category: 'Kettlebells',
  active: true,
  price: { amount: 39990, currency: 'CLP' },
  stock: { status: 'in_stock', quantity: 5, available: true },
  attributes: [{ group: 'Peso', value: '16 kg' }],
};

export const inactiveBar: ProductIntentCatalogProduct = {
  ...olympicBar15,
  productId: '99',
  name: 'Barra inactiva',
  active: false,
};

export const outOfStockBar: ProductIntentCatalogProduct = {
  ...olympicBar20,
  productId: '100',
  name: 'Barra sin stock',
  stock: { status: 'out_of_stock', quantity: 0, available: false },
};

export const unknownStockBar: ProductIntentCatalogProduct = {
  ...olympicBar20,
  productId: '101',
  name: 'Barra stock desconocido',
  stock: { status: 'unknown', available: false },
};

export const noPriceBar: ProductIntentCatalogProduct = {
  ...olympicBar20,
  productId: '102',
  name: 'Barra sin precio',
  price: null,
};

export const baseResolveProductIntentRequest: ResolveProductIntentRequest = {
  query: 'barra olimpica 15 kg',
  filters: { inStockOnly: true },
  limit: 5,
  correlationId: 'corr-body',
};

export class FakeProductIntentSearcher implements CatalogProductIntentSearcher {
  calls: Array<{ query: NormalizedProductQuery; limit: number; includeOutOfStock: boolean }> = [];

  failWith: Error | null = null;

  constructor(private readonly hits: readonly ProductIntentSearchHit[] = []) {}

  async search(input: {
    readonly query: NormalizedProductQuery;
    readonly limit: number;
    readonly includeOutOfStock: boolean;
  }): Promise<readonly ProductIntentSearchHit[]> {
    this.calls.push(clone(input));
    if (this.failWith) throw this.failWith;
    return this.hits.slice(0, input.limit).map(clone);
  }
}

export class FakeProductIntentBatchReader implements CatalogProductIntentBatchReader {
  calls: Array<{ references: readonly ProductIntentReference[]; correlationId: string }> = [];

  failWith: Error | null = null;

  private readonly products = new Map<string, ProductIntentCatalogProduct>();

  constructor(products: readonly ProductIntentCatalogProduct[] = [olympicBar15, olympicBar20, hexBar, curlBar, bumper20, kettlebell16]) {
    for (const product of products) {
      this.products.set(createProductIntentIdentity(product), product);
    }
  }

  async getProductsByReferences(
    references: readonly ProductIntentReference[],
    correlationId: string,
  ): Promise<ReadonlyMap<string, ProductIntentCatalogProduct>> {
    this.calls.push({ references: clone(references), correlationId });
    if (this.failWith) throw this.failWith;
    const result = new Map<string, ProductIntentCatalogProduct>();
    for (const reference of references) {
      const product = this.products.get(createProductIntentIdentity(reference));
      if (product) {
        result.set(createProductIntentIdentity(reference), clone(product));
      }
    }
    return result;
  }
}

export class FakeProductIntentLogger implements ProductIntentLogger {
  events: Array<{ event: string; fields: Readonly<Record<string, unknown>>; level: 'info' | 'error' }> = [];

  info(event: string, fields: Readonly<Record<string, unknown>>): void {
    this.events.push({ event, fields, level: 'info' });
  }

  error(event: string, fields: Readonly<Record<string, unknown>>): void {
    this.events.push({ event, fields, level: 'error' });
  }
}

export function hit(product: ProductIntentCatalogProduct): ProductIntentSearchHit {
  return {
    product: {
      productId: product.productId,
      ...(product.combinationId === undefined ? {} : { combinationId: product.combinationId }),
    },
    query: 'fixture',
  };
}

export function buildProductIntentHarness(options: {
  hits?: readonly ProductIntentSearchHit[];
  products?: readonly ProductIntentCatalogProduct[];
} = {}) {
  const searcher = new FakeProductIntentSearcher(options.hits ?? [
    hit(olympicBar15),
    hit(olympicBar20),
    hit(hexBar),
    hit(curlBar),
    hit(bumper20),
    hit(kettlebell16),
  ]);
  const catalog = new FakeProductIntentBatchReader(options.products);
  const logger = new FakeProductIntentLogger();
  const service = new DefaultProductIntentResolutionService({
    normalizer: new DefaultProductQueryNormalizer(),
    synonymProvider: new StaticProductSearchSynonymProvider(),
    searcher,
    catalogReader: catalog,
    ranker: new DefaultProductIntentCandidateRanker(),
    resolutionPolicy: new DefaultProductIntentResolutionPolicy(),
    clarificationBuilder: new DefaultProductClarificationBuilder(),
    correlationIdProvider: {
      generate: () => 'corr-generated',
    },
    logger,
  });
  return {
    service,
    searcher,
    catalog,
    logger,
  };
}
