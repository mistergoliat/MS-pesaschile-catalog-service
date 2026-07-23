import { join } from 'node:path';
import {
  DefaultProductTransactionNormalizer,
} from '../../../domain/recommendation/relationship-engine/normalization/index.js';
import { SameOrderRelationshipCalculator } from '../../../domain/recommendation/relationship-engine/calculators/index.js';
import { EvidenceBasedRelationshipReliabilityEvaluator } from '../../../domain/recommendation/relationship-engine/reliability/index.js';
import { DefaultProductRelationshipValidator } from '../../../domain/recommendation/relationship-engine/validation/index.js';
import type { ProductRelationshipBuildInput } from '../../../domain/recommendation/relationship-engine/contracts.js';
import {
  DefaultProductRelationshipSnapshotBuilder,
  DefaultProductRelationshipSnapshotPublisher,
  type ProductRelationshipSnapshotStore,
} from '../../../domain/recommendation/relationship-engine/publication/index.js';
import type {
  HistoricalOrderTransactionReader,
  RelationshipSnapshotBuildConfig,
  RelationshipSnapshotBuildService,
  RelationshipSnapshotBuildSummary,
} from './contracts.js';

function snapshotHash(snapshotId: string): string {
  return snapshotId.replace(/^sha256:/u, '');
}

function snapshotPath(snapshotDirectory: string, snapshotId: string): string {
  return join(snapshotDirectory, 'snapshots', `${snapshotHash(snapshotId)}.json`);
}

function activePointerPath(snapshotDirectory: string): string {
  return join(snapshotDirectory, 'active.json');
}

export class RelationshipSnapshotBuildError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RelationshipSnapshotBuildError';
  }
}

export class DefaultRelationshipSnapshotBuildService implements RelationshipSnapshotBuildService {
  constructor(
    private readonly reader: HistoricalOrderTransactionReader,
    private readonly store: ProductRelationshipSnapshotStore,
  ) {}

  async build(config: RelationshipSnapshotBuildConfig): Promise<RelationshipSnapshotBuildSummary> {
    const startedAt = Date.now();
    const sourceRead = await this.reader.read(config.source);
    const normalizer = new DefaultProductTransactionNormalizer();
    const normalized = normalizer.normalize({
      records: [...sourceRead.records],
      config: {
        acceptedOrderStatuses: [...config.source.acceptedOrderStates],
        maximumDistinctProductsPerTransaction: config.maximumDistinctProductsPerOrder,
        minimumOccurredAt: config.source.from,
        ...(config.source.to ? { maximumOccurredAt: config.source.to } : {}),
        allowAnonymousTransactions: true,
        duplicateTransactionStrategy: 'reject',
        duplicateProductStrategy: 'aggregate_quantity',
        outputOrder: 'occurred_at_then_transaction_id',
      },
    });

    const latestAcceptedTransaction = normalized.dataset.transactions.at(-1);
    const evidenceWindow = {
      from: config.source.from,
      to: config.source.to ?? latestAcceptedTransaction?.occurredAt ?? config.source.from,
    };
    const buildInput: ProductRelationshipBuildInput = {
      publicationId: `offline-same-order:${evidenceWindow.from}:${evidenceWindow.to}`,
      modelVersion: config.modelVersion,
      dataWindow: evidenceWindow,
      relationshipTypes: ['same_order'],
      parameters: {
        minimumJointCount: config.minimumJointCount,
        minimumConfidence: config.minimumConfidence,
        minimumLift: config.minimumLift,
        maximumRelationshipsPerSource: config.maximumRelationshipsPerSource,
        maximumDistinctProductsPerTransaction: config.maximumDistinctProductsPerOrder,
      },
    };

    const calculatedCandidates = new SameOrderRelationshipCalculator().calculate({
      dataset: normalized.dataset,
      buildInput,
    });
    const relationships = new EvidenceBasedRelationshipReliabilityEvaluator().evaluateCandidates(calculatedCandidates.candidates);
    const validation = new DefaultProductRelationshipValidator().validate({
      relationships,
      parameters: {
        minimumReliability: config.minimumReliability,
        rejectNegativeAssociation: true,
      },
    });

    if (validation.validRelationships.length === 0) {
      throw new RelationshipSnapshotBuildError('No valid relationships were produced; active snapshot was not changed');
    }

    const publisher = new DefaultProductRelationshipSnapshotPublisher(
      new DefaultProductRelationshipSnapshotBuilder(),
      this.store,
    );
    const publication = await publisher.publish({
      relationships: validation.validRelationships,
      parameters: {
        allowEmptySnapshot: false,
      },
    });

    return {
      sourceOrdersRead: sourceRead.statistics.sourceOrdersRead,
      sourceLinesRead: sourceRead.statistics.sourceLinesRead,
      ordersAccepted: normalized.statistics.transactionsAccepted,
      ordersExcluded: normalized.statistics.transactionsRejected + sourceRead.statistics.sourceOrdersExcluded,
      distinctProducts: normalized.statistics.distinctProductsObserved,
      pairCandidates: calculatedCandidates.statistics.candidatesGenerated,
      reliableCandidates: relationships.length,
      validRelationships: validation.statistics.relationshipsAccepted,
      rejectedRelationships: validation.statistics.relationshipsRejected,
      snapshotId: publication.snapshot.snapshotId,
      snapshotVersion: publication.snapshot.schemaVersion,
      snapshotHash: snapshotHash(publication.snapshot.snapshotId),
      snapshotPath: snapshotPath(config.snapshotDirectory, publication.snapshot.snapshotId),
      activePointerPath: activePointerPath(config.snapshotDirectory),
      durationMs: Date.now() - startedAt,
      details: {
        source: sourceRead.statistics,
        normalization: normalized.statistics,
        calculation: calculatedCandidates.statistics,
        validation: validation.statistics,
        publication: publication.statistics,
      },
    };
  }
}
