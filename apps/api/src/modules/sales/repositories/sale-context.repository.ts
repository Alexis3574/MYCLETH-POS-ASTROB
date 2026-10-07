import type {
  SaleTransaction,
} from "../types/sales.types.js";

export const saleContextRepository = {
  async findCompany(
    tx: SaleTransaction,
    empresaId: bigint,
  ) {
    return tx.empresa.findFirst({
      where: {
        id: empresaId,
        activo: true,
      },
      select: {
        id: true,
      },
    });
  },

  async findBranch(
    tx: SaleTransaction,
    empresaId: bigint,
    sucursalId: bigint,
  ) {
    return tx.sucursal.findFirst({
      where: {
        id: sucursalId,
        empresa_id: empresaId,
        activo: true,
      },
      select: {
        id: true,
        empresa_id: true,
      },
    });
  },

  async findWarehouse(
    tx: SaleTransaction,
    sucursalId: bigint,
    almacenId: bigint,
  ) {
    return tx.almacen.findFirst({
      where: {
        id: almacenId,
        sucursal_id: sucursalId,
        activo: true,
      },
      select: {
        id: true,
        sucursal_id: true,
      },
    });
  },

  async findUser(
    tx: SaleTransaction,
    empresaId: bigint,
    usuarioId: bigint,
  ) {
    return tx.usuario.findFirst({
      where: {
        id: usuarioId,
        empresa_id: empresaId,
        activo: true,
        bloqueado: false,
      },
      select: {
        id: true,
        empresa_id: true,
        username: true,
      },
    });
  },

  async findClient(
    tx: SaleTransaction,
    empresaId: bigint,
    clienteId: bigint,
  ) {
    return tx.cliente.findFirst({
      where: {
        id: clienteId,
        empresa_id: empresaId,
        activo: true,
      },
      select: {
        id: true,
        empresa_id: true,
        codigo: true,
        nombre: true,
      },
    });
  },

  async findCashSession(
    tx: SaleTransaction,
    sesionCajaId: bigint,
  ) {
    return tx.sesion_caja.findUnique({
      where: {
        id: sesionCajaId,
      },
      select: {
        id: true,
        caja_id: true,
        usuario_apertura_id: true,
        fecha_apertura: true,
        fecha_cierre: true,
        estado: true,

        caja: {
          select: {
            id: true,
            sucursal_id: true,
            codigo: true,
            nombre: true,
            activo: true,
          },
        },
      },
    });
  },
};