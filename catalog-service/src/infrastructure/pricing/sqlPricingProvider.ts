import type { PricingProvider } from '../../domain/catalog/ports.js';
import type { CatalogRepository } from '../../domain/catalog/ports.js';
import type { PriceContext } from '../../domain/pricing/types.js';
import { config } from '../../shared/config.js';
import { resolvePrice } from './priceResolver.js';

export class SqlPricingProvider implements PricingProvider {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly currencyCode = config.prestashop.currencyCode,
    private readonly taxRate = config.pricing.taxRate,
  ) {}

  async quote(input: {
    productId: number;
    combinationId: number;
    quantity: number;
    customerId: number;
    customerGroupId: number;
    currencyId: number;
    countryId: number;
  }) {
    const basePrices = await this.repository.getBasePrices(input.productId, input.combinationId);
    const specificPrices = await this.repository.getSpecificPrices({
      ...input,
      shopId: config.prestashop.shopId,
    });

    const priceContext: PriceContext = {
      ...input,
      shopId: config.prestashop.shopId,
      currencyCode: this.currencyCode,
      taxRate: this.taxRate,
    };

    return resolvePrice(
      {
        baseProductPrice: basePrices.productPrice,
        combinationImpact: basePrices.combinationImpact,
        specificPrices,
      },
      priceContext,
    );
  }
}
