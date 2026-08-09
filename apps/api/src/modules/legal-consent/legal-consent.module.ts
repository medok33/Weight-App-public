import { Module } from '@nestjs/common';
import { LegalConsentService } from './application/legal-consent.service';

@Module({
  providers: [LegalConsentService],
  exports: [LegalConsentService],
})
export class LegalConsentModule {}
