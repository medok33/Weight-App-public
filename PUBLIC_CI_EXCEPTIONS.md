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
