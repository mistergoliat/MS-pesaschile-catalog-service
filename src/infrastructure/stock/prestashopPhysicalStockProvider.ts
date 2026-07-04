import type { CatalogRepository, StockProvider } from '../../domain/catalog/ports.js';
import { StockUnavailableError } from '../../shared/errors.js';

export class PrestaShopPhysicalStockProvider implements StockProvider {
  constructor(private readonly repository: CatalogRepository) {}

  async getStock(productId: number, combinationId: number) {
    const row = await this.repository.getStock(productId, combinationId);
    if (!row) {
      throw new StockUnavailableError();
    }

    return {
      physicalQuantity: row.physicalQuantity,
      available: row.physicalQuantity > 0,
      shopId: row.shopId,
    };
  }

  async getVariantStocks(productId: number) {
    const rows = await this.repository.getStockForProduct(productId);
    return rows.map((row) => ({
      combinationId: row.combinationId,
      physicalQuantity: row.physicalQuantity,
      available: row.physicalQuantity > 0,
      shopId: row.shopId,
    }));
  }
}
