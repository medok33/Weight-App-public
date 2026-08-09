import type { EntitlementStatus } from './entitlements.types';
export function validateEntitlementKey(key:string){if(!/^[a-z][a-z0-9._-]{2,63}$/.test(key))throw new Error('ENTITLEMENT_KEY_INVALID');return key;}
export function canAccessEntitlement(status:EntitlementStatus,startsAt:Date,endsAt:Date|null,now=new Date()){if(status!=='active'||startsAt>now)return false;return !endsAt||endsAt>now;}
