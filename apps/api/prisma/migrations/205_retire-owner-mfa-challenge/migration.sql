-- ARCH-SEC-02C: retire placeholder OwnerMfaChallenge.
-- Authoritative MFA path is Session.mfaVerifiedAt + active OwnerMfaCredential.
DROP TABLE IF EXISTS "OwnerMfaChallenge";
