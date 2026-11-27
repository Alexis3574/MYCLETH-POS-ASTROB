export function toCents(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= 99999999999999 ? cents : null
}
export function remainingPayment(total: number, payments: { key: number; amount: string }[], except?: number): string | null {
  if (!Number.isFinite(total) || total < 0) return null
  let balance = Math.round(total * 100)
  for (const payment of payments) {
    if (payment.key === except) continue
    const value = toCents(payment.amount)
    if (value === null) return null
    balance -= value
  }
  return balance > 0 ? (balance / 100).toFixed(2) : null
}
export function cashChange(received: string, applied: string): string | null {
  const cash = toCents(received), payment = toCents(applied)
  return cash === null || payment === null || cash < payment ? null : ((cash - payment) / 100).toFixed(2)
}
