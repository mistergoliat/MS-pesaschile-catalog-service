import type {
  ProductInteractionDataset,
  ProductRelationshipBuildInput,
  ProductRelationshipProductReference,
  ProductTransaction,
} from '../../src/domain/recommendation/relationship-engine/contracts.js';

export const productA: ProductRelationshipProductReference = { productId: 'A' };
export const productB: ProductRelationshipProductReference = { productId: 'B' };
export const productC: ProductRelationshipProductReference = { productId: 'C' };
export const productD: ProductRelationshipProductReference = { productId: 'D' };
export const productACombination1: ProductRelationshipProductReference = { productId: 'A', combinationId: '1' };
export const productACombination2: ProductRelationshipProductReference = { productId: 'A', combinationId: '2' };

export const buildInputBase: ProductRelationshipBuildInput = {
  publicationId: 'same-order-publication-001',
  modelVersion: 'same-order.0',
  dataWindow: {
    from: '2025-01-01T00:00:00.000Z',
    to: '2025-12-31T23:59:59.000Z',
  },
  relationshipTypes: ['same_order'],
  parameters: {
    minimumJointCount: 1,
    minimumConfidence: 0,
    minimumLift: 0,
    maximumRelationshipsPerSource: 50,
    maximumDistinctProductsPerTransaction: 20,
  },
};

export function buildInputWith(overrides: Partial<ProductRelationshipBuildInput['parameters']>): ProductRelationshipBuildInput {
  return {
    ...buildInputBase,
    parameters: {
      ...buildInputBase.parameters,
      ...overrides,
    },
  };
}

export function order(
  transactionId: string,
  products: ProductRelationshipProductReference[],
  occurredAt = '2025-06-01T12:00:00.000Z',
): ProductTransaction {
  return {
    transactionId,
    transactionType: 'order',
    occurredAt,
    customerKey: `customer-${transactionId}`,
    products: products.map((product) => ({ product, quantity: 1 })),
  };
}

export function cart(transactionId: string, products: ProductRelationshipProductReference[]): ProductTransaction {
  return {
    transactionId,
    transactionType: 'cart',
    occurredAt: '2025-06-01T12:00:00.000Z',
    products: products.map((product) => ({ product, quantity: 1 })),
  };
}

export const emptyDataset: ProductInteractionDataset = {
  transactions: [],
  rules: [],
};

export const onlyCartsDataset: ProductInteractionDataset = {
  transactions: [cart('cart-001', [productA, productB]), cart('cart-002', [productB, productC])],
  rules: [],
};

export const singleProductOrderDataset: ProductInteractionDataset = {
  transactions: [order('order-single-001', [productA])],
  rules: [],
};

export const twoProductOrderDataset: ProductInteractionDataset = {
  transactions: [order('order-two-001', [productA, productB])],
  rules: [],
};

export const threeProductOrderDataset: ProductInteractionDataset = {
  transactions: [order('order-three-001', [productA, productB, productC])],
  rules: [],
};

export const multipleOrdersDataset: ProductInteractionDataset = {
  transactions: [
    order('order-001', [productA, productB]),
    order('order-002', [productA, productB]),
    order('order-003', [productA, productC]),
  ],
  rules: [],
};

export const combinationsDataset: ProductInteractionDataset = {
  transactions: [
    order('order-combo-001', [productA, productACombination1, productACombination2]),
  ],
  rules: [],
};

export const quantityDataset: ProductInteractionDataset = {
  transactions: [
    {
      ...order('order-quantity-001', [productA, productB]),
      products: [
        { product: productA, quantity: 10 },
        { product: productB, quantity: 1 },
      ],
    },
  ],
  rules: [],
};

export const windowBoundaryDataset: ProductInteractionDataset = {
  transactions: [
    order('order-from-boundary', [productA, productB], '2025-01-01T00:00:00.000Z'),
    order('order-to-boundary', [productA, productC], '2025-12-31T23:59:59.000Z'),
  ],
  rules: [],
};

export const outsideWindowDataset: ProductInteractionDataset = {
  transactions: [
    order('order-before-window', [productA, productB], '2024-12-31T23:59:59.000Z'),
    order('order-after-window', [productA, productC], '2026-01-01T00:00:00.000Z'),
    order('order-inside-window', [productA, productD], '2025-06-01T12:00:00.000Z'),
  ],
  rules: [],
};

export const lowConfidenceDataset: ProductInteractionDataset = {
  transactions: [
    order('order-low-conf-001', [productA, productB]),
    order('order-low-conf-002', [productA, productC]),
    order('order-low-conf-003', [productA, productD]),
  ],
  rules: [],
};

export const lowLiftDataset: ProductInteractionDataset = {
  transactions: [
    order('order-low-lift-001', [productA, productB]),
    order('order-low-lift-002', [productA, productC]),
    order('order-low-lift-003', [productB, productC]),
    order('order-low-lift-004', [productD, productC]),
  ],
  rules: [],
};

export const sourceLimitDataset: ProductInteractionDataset = {
  transactions: [
    order('order-limit-001', [productA, productB]),
    order('order-limit-002', [productA, productB]),
    order('order-limit-003', [productA, productC]),
    order('order-limit-004', [productA, productC]),
    order('order-limit-005', [productA, productD]),
  ],
  rules: [],
};

export const tieDataset: ProductInteractionDataset = {
  transactions: [
    order('order-tie-001', [productA, productB, productC]),
  ],
  rules: [],
};

export const multiSourceLimitDataset: ProductInteractionDataset = {
  transactions: [
    order('order-ms-001', [productA, productB, productC]),
    order('order-ms-002', [productD, productB, productC]),
  ],
  rules: [],
};

export const unorderedDataset: ProductInteractionDataset = {
  transactions: [
    order('order-003', [productC, productA]),
    order('order-001', [productB, productA]),
    order('order-002', [productA, productD]),
  ],
  rules: [],
};

export const mixedCustomerDataset: ProductInteractionDataset = {
  transactions: [
    order('order-with-customer', [productA, productB]),
    {
      ...order('order-without-customer', [productA, productB]),
      customerKey: undefined,
    },
  ],
  rules: [],
};

export const sameOrderRelationshipCalculatorFixtures = {
  productA,
  productB,
  productC,
  productD,
  productACombination1,
  productACombination2,
  buildInputBase,
  emptyDataset,
  onlyCartsDataset,
  singleProductOrderDataset,
  twoProductOrderDataset,
  threeProductOrderDataset,
  multipleOrdersDataset,
  combinationsDataset,
  quantityDataset,
  windowBoundaryDataset,
  outsideWindowDataset,
  lowConfidenceDataset,
  lowLiftDataset,
  sourceLimitDataset,
  tieDataset,
  multiSourceLimitDataset,
  unorderedDataset,
  mixedCustomerDataset,
} as const;

