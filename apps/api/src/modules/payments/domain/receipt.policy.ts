import type { ReceiptRequest } from './receipt.types';
export function validateReceiptRequest(input:ReceiptRequest):ReceiptRequest { if(!/^[0-9a-f-]{36}$/.test(input.paymentId)||input.provider!=='npd'||!/^[a-zA-Z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new Error('RECEIPT_REQUEST_INVALID'); return input; }
