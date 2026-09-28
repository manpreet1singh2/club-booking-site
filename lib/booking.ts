export const ADVANCE_RATE = 0.15;
export function calculateBookingAmounts(total: number) {
  const totalAmount = Math.max(0, Number(total) || 0);
  const advanceAmount = Math.round(totalAmount * ADVANCE_RATE * 100) / 100;
  return { totalAmount, advanceAmount, remainingAmount: Math.round((totalAmount - advanceAmount) * 100) / 100 };
}
export function createBookingCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `LIC-${date}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
