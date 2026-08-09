-- ARCH-SEC-02C: allow MFA throttle subjects in AuthThrottleBucket.
-- Runtime MFA abuse controls use action=mfa_challenge and subjectType=challenge.

ALTER TABLE "AuthThrottleBucket" DROP CONSTRAINT IF EXISTS "AuthThrottleBucket_action_check";
ALTER TABLE "AuthThrottleBucket"
  ADD CONSTRAINT "AuthThrottleBucket_action_check"
  CHECK ("action" IN ('login', 'register', 'password_reset', 'mfa_challenge'));

ALTER TABLE "AuthThrottleBucket" DROP CONSTRAINT IF EXISTS "AuthThrottleBucket_subjectType_check";
ALTER TABLE "AuthThrottleBucket"
  ADD CONSTRAINT "AuthThrottleBucket_subjectType_check"
  CHECK ("subjectType" IN ('account', 'ip', 'account_ip', 'challenge'));
