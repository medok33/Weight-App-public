import type { ConsentRecord } from '../domain/legal-consent.types';
export class LegalConsentRepository { private readonly records: ConsentRecord[] = []; add(record: ConsentRecord): void { this.records.push(record); } list(userId: string) { return this.records.filter((record) => record.userId === userId); } }
