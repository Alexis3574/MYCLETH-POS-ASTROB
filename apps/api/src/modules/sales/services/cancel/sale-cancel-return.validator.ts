import type {
  SaleTransaction,
} from "../../types/sales.types.js";


export async function saleHasReturns(
  tx: SaleTransaction,
  saleId: bigint,
): Promise<boolean> {
  const count =
    await tx.devolucion_venta.count({
      where: {
        venta_id: saleId,
      },
    });

  return count > 0;
}