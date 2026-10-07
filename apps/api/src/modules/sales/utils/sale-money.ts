export function roundMoney(
  value: number,
): number {
  return (
    Math.round(
      (value + Number.EPSILON) * 100,
    ) / 100
  );
}

export function moneyToCents(
  value: number,
): number {
  return Math.round(
    roundMoney(value) * 100,
  );
}

export function decimalToNumber(
  value: unknown,
): number {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(
      "Se encontró un valor numérico inválido.",
    );
  }

  return numberValue;
}