export type EntitlementStatus = 'active' | 'revoked' | 'expired';
export type Entitlement = { id:string; userId:string; key:string; status:EntitlementStatus; startsAt:string; endsAt:string|null; sourcePaymentId:string|null; metadata:Record<string,unknown> };
