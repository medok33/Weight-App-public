import { Injectable } from '@nestjs/common';
import {
  REQUIRED_CONSENTS,
  REQUIRED_LEGAL_DOCUMENTS,
  checkLegalContentVersions,
  validateLegalDocumentVersion,
} from '../domain/legal-consent.policy';
import type { LegalDocumentVersion } from '../domain/legal-consent.types';

@Injectable()
export class LegalConsentService {
  hasRequired(granted: readonly string[]): boolean {
    return REQUIRED_CONSENTS.every((kind) => granted.includes(kind));
  }

  /** STEP_166: verify published legal docs meet required content versions. */
  checkVersions(published: LegalDocumentVersion[]) {
    if (!Array.isArray(published)) throw new Error('LEGAL_DOC_INVALID');
    return checkLegalContentVersions(published, REQUIRED_LEGAL_DOCUMENTS);
  }

  requiredCatalog() {
    return REQUIRED_LEGAL_DOCUMENTS.map(validateLegalDocumentVersion);
  }
}
