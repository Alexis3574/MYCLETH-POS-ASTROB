import {
  SaleContextError,
} from "../../errors/sale.errors.js";

import {
  saleContextRepository,
} from "../../repositories/sale-context.repository.js";

import type {
  CreateSaleInput,
  SaleTransaction,
} from "../../types/sales.types.js";

export async function validateSaleContext(
  tx: SaleTransaction,
  input: CreateSaleInput,
): Promise<void> {
  const company =
    await saleContextRepository.findCompany(
      tx,
      input.empresaId,
    );

  if (!company) {
    throw new SaleContextError(
      "empresa_id",
      "La empresa indicada no existe o está inactiva.",
    );
  }

  const branch =
    await saleContextRepository.findBranch(
      tx,
      input.empresaId,
      input.sucursalId,
    );

  if (!branch) {
    throw new SaleContextError(
      "sucursal_id",
      "La sucursal indicada no existe, está inactiva o no pertenece a la empresa.",
    );
  }

  const warehouse =
    await saleContextRepository.findWarehouse(
      tx,
      input.sucursalId,
      input.almacenId,
    );

  if (!warehouse) {
    throw new SaleContextError(
      "almacen_id",
      "El almacén indicado no existe, está inactivo o no pertenece a la sucursal.",
    );
  }

  const user =
    await saleContextRepository.findUser(
      tx,
      input.empresaId,
      input.usuarioId,
    );

  if (!user) {
    throw new SaleContextError(
      "usuario_id",
      "El usuario indicado no existe, está inactivo, está bloqueado o no pertenece a la empresa.",
    );
  }

  if (
    input.clienteId !== undefined &&
    input.clienteId !== null
  ) {
    const client =
      await saleContextRepository.findClient(
        tx,
        input.empresaId,
        input.clienteId,
      );

    if (!client) {
      throw new SaleContextError(
        "cliente_id",
        "El cliente indicado no existe, está inactivo o no pertenece a la empresa.",
      );
    }
  }

  if (
    input.sesionCajaId === undefined ||
    input.sesionCajaId === null
  ) {
    return;
  }

  const cashSession =
    await saleContextRepository.findCashSession(
      tx,
      input.sesionCajaId,
    );

  if (!cashSession) {
    throw new SaleContextError(
      "sesion_caja_id",
      "La sesión de caja indicada no existe.",
    );
  }

  if (
    cashSession.estado !== "ABIERTA" ||
    cashSession.fecha_cierre !== null
  ) {
    throw new SaleContextError(
      "sesion_caja_id",
      "La sesión de caja indicada no se encuentra abierta.",
    );
  }

  if (!cashSession.caja.activo) {
    throw new SaleContextError(
      "sesion_caja_id",
      "La caja asociada a la sesión se encuentra inactiva.",
    );
  }

  if (
    cashSession.caja.sucursal_id !==
    input.sucursalId
  ) {
    throw new SaleContextError(
      "sesion_caja_id",
      "La sesión de caja no pertenece a la sucursal de la venta.",
    );
  }

  if (
    cashSession.usuario_apertura_id !==
    input.usuarioId
  ) {
    throw new SaleContextError(
      "sesion_caja_id",
      "La sesión de caja no fue abierta por el usuario que registra la venta.",
    );
  }
}