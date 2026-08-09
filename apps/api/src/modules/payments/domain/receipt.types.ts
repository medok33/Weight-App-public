export type ReceiptStatus = 'queued' | 'issued' | 'failed';
export type ReceiptRequest = { paymentId:string; provider:'npd'; status:ReceiptStatus; idempotencyKey:string };
