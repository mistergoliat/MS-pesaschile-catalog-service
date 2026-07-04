import type { FastifyRequest } from 'fastify';
import { config } from './config.js';

export type CommercialContext = {
  customerId: number;
  customerGroupId: number;
  currencyId: number;
  countryId: number;
};

export function readCommercialContext(request: FastifyRequest): CommercialContext {
  const headers = request.headers;
  const customerId = Number(headers['x-customer-id'] ?? 0);
  const customerGroupId = Number(headers['x-customer-group-id'] ?? config.prestashop.customerGroupId);
  const currencyId = Number(headers['x-currency-id'] ?? config.prestashop.currencyId);
  const countryId = Number(headers['x-country-id'] ?? config.prestashop.countryId);

  return {
    customerId: Number.isFinite(customerId) ? customerId : 0,
    customerGroupId: Number.isFinite(customerGroupId) ? customerGroupId : config.prestashop.customerGroupId,
    currencyId: Number.isFinite(currencyId) ? currencyId : config.prestashop.currencyId,
    countryId: Number.isFinite(countryId) ? countryId : config.prestashop.countryId,
  };
}
