# Public CI exception register

## `PRIVATE_OPERATIONAL_TEST_NOT_APPLICABLE`

- Test: `apps/api/test/database/owner-mfa.persistence.spec.ts`
- Result: `NOT_APPLICABLE`
- Reason: `PRIVATE_OPERATIONAL_DEPENDENCY_EXCLUDED_FROM_PUBLIC_REPOSITORY`
- Excluded dependency: privileged owner-MFA emergency-reset database tool
- Scope: public repository CI only

All other applicable public tests and verification jobs remain required. The
private test and its privileged dependency remain unchanged in the private
repository.

## `PRIVATE_DEPLOYMENT_CONTRACT_NOT_APPLICABLE`

The following exact test cases validate private deployment surfaces excluded
from this repository:

- `apps/web/src/lib/__tests__/deploy-01b-docker-contract.spec.ts` — prod-like compose contract
- `apps/web/src/lib/__tests__/deploy-01b-docker-contract.spec.ts` — staging/production immutable-image compose contract
- `apps/web/src/lib/__tests__/deploy-01c-environment-contract.spec.ts` — staging/production compose project names
- `apps/web/src/lib/__tests__/deploy-01c-environment-contract.spec.ts` — staging/production env template boundary
- `apps/web/src/lib/__tests__/deploy-01d-workflow-contract.spec.ts` — private release workflow/GHCR publishing contract

Reason for each: `PRIVATE_DEPLOYMENT_SURFACE_EXCLUDED_FROM_PUBLIC_REPOSITORY`.
The public application, Docker build, security, and runtime assertions in
those files remain required; only these named deployment-only cases are N/A.
