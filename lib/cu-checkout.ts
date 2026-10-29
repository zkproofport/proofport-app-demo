export const CU_UNIT_PRICE = 3_000;
export const CU_MAX_QUANTITY = 4;
export const CU_CURRENCY = 'dKRW';

export const formatCuAmount = (amount: number) => `${amount.toLocaleString('ko-KR')} ${CU_CURRENCY}`;

/** Local presentation receipt; the request ID is never a transaction hash. */
export interface CuPaymentReceiptData {
  requestId: string;
  total: number;
  quantity: number;
  completedAt: number;
}
