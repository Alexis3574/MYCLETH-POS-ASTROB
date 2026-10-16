export interface SaleReturnDetailInput {
  saleDetailId: bigint;
  cantidad: number;
}

export interface SaleReturnRefundInput {
  salePaymentId: bigint;
  monto: number;
  referencia?: string | null;
}

export interface CreateSaleReturnInput {
  saleId: bigint;
  empresaId: bigint;
  usuarioId: bigint;
  folio: string;
  motivo: string;
  sesionCajaId?: bigint | null;
  ipOrigen?: string | null;
  detalles: SaleReturnDetailInput[];
  reembolsos: SaleReturnRefundInput[];
}
