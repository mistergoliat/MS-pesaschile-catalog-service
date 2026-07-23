import type {
  CustomerAffinityContext,
  CustomerAffinityCustomerReference,
  CustomerAffinityEvidenceProvider,
  CustomerAffinityEvidenceResult,
} from '../../domain/recommendation/customer-affinity/index.js';
import { CustomerAffinityError } from '../../domain/recommendation/customer-affinity/index.js';
import type { ProductRelationshipProductReference } from '../../domain/recommendation/relationship-engine/contracts.js';

export class EmptyCustomerAffinityEvidenceProvider implements CustomerAffinityEvidenceProvider {
  async getEvidence(
    customer: CustomerAffinityCustomerReference,
    _products: readonly ProductRelationshipProductReference[],
    _context?: CustomerAffinityContext,
  ): Promise<CustomerAffinityEvidenceResult> {
    return {
      customer,
      productEvidence: [],
      warnings: [],
    };
  }
}

export class UnavailableCustomerAffinityEvidenceProvider implements CustomerAffinityEvidenceProvider {
  async getEvidence(): Promise<CustomerAffinityEvidenceResult> {
    throw new CustomerAffinityError('EVIDENCE_PROVIDER_FAILED', 'Customer affinity evidence source is not configured', {
      retryable: true,
    });
  }
}
