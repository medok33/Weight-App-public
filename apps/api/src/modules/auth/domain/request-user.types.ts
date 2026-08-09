export type RequestUser = {
  id: string;
  email: string | null;
  username: string | null;
  role: string;
  mfaVerifiedAt?: Date | null;
  recentOwnerReauthAt?: Date | null;
};
