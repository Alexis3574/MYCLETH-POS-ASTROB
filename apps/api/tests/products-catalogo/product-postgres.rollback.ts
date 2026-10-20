import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { prisma } from "../../src/lib/prisma.js";
import { productRepository } from "../../src/modules/products/repositories/product.repository.js";
import { validateProductReferences, validateStockBounds } from "../../src/modules/products/validators/product.validator.js";
import { createProductSchema, productQuerySchema } from "../../src/modules/products/product.schema.js";
import { serializeProduct } from "../../src/modules/products/utils/product.serializer.js";

test("Productos/Catálogo: integración PostgreSQL y rollback", async () => {
  const connection = process.env.DATABASE_URL;
  assert.ok(connection, "DATABASE_URL no configurada");

  const url = new URL(connection);

  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    (!url.port || url.port === "5432") &&
    url.pathname === "/pos_novnix",
    "La conexión no corresponde a pos_novnix local"
  );

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const marker = `PRODUCT_TEST_${suffix}`;
  const sku = `PT_${suffix}`;
  const barcode = `PTBAR_${suffix}`;
  const rollback = new Error("PRODUCT_TEST_ROLLBACK");

  let checks = 0;

  const passed = (message: string) => {
    checks++;
    console.log(`[OK] ${message}`);
  };

  try {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const company = await tx.empresa.create({
          data: {
            razon_social: marker,
            nombre_comercial: marker,
          },
        });

        const foreign = await tx.empresa.create({
          data: {
            razon_social: `${marker}_FOREIGN`,
            nombre_comercial: `${marker}_FOREIGN`,
          },
        });

        const unit = await tx.unidad_medida.create({
          data: {
            codigo: sku,
            nombre: "Unidad de prueba",
            permite_decimales: true,
          },
        });

        const category = await tx.categoria.create({
          data: {
            empresa_id: company.id,
            nombre: `Categoria_${suffix}`,
          },
        });

        const foreignCategory = await tx.categoria.create({
          data: {
            empresa_id: foreign.id,
            nombre: `Categoria_${suffix}`,
          },
        });

        const tax = await tx.impuesto.create({
          data: {
            empresa_id: company.id,
            codigo: sku,
            nombre: "Impuesto de prueba",
            tasa: "0.1600",
          },
        });

        const foreignTax = await tx.impuesto.create({
          data: {
            empresa_id: foreign.id,
            codigo: sku,
            nombre: "Impuesto de otra empresa",
            tasa: "0.1600",
          },
        });

        passed("Empresas y catálogos sintéticos creados");

        await validateProductReferences(tx, company.id, {
          categoria_id: category.id,
          unidad_medida_id: unit.id,
          impuesto_ids: [tax.id],
        });

        await assert.rejects(
          () => validateProductReferences(tx, company.id, {
            categoria_id: foreignCategory.id,
          }),
          { code: "INVALID_PRODUCT_CATEGORY" }
        );

        await assert.rejects(
          () => validateProductReferences(tx, company.id, {
            impuesto_ids: [foreignTax.id],
          }),
          { code: "INVALID_PRODUCT_TAXES" }
        );

        passed("Referencias válidas y aislamiento de catálogos");

        assert.doesNotThrow(() =>
          validateStockBounds("1.000", "10.000")
        );

        assert.throws(
          () => validateStockBounds("10.000", "1.000"),
          { code: "INVALID_STOCK_RANGE" }
        );

        passed("Rangos de existencias validados");

        const input = createProductSchema.parse({
          sku,
          codigo_barras: barcode,
          nombre: "Producto de integración",
          unidad_medida_id: unit.id.toString(),
          categoria_id: category.id.toString(),
          impuesto_ids: [tax.id.toString()],
          precio_venta: "125.50",
          costo_referencia: "85.2500",
          stock_minimo: "1.000",
          stock_maximo: "20.000",
        });

        const {
          impuesto_ids,
          controla_inventario: _control,
          ...fields
        } = input;

        const created = await productRepository.create(tx, {
          ...fields,
          empresa_id: company.id,
          controla_inventario: true,
          activo: true,
        });

        await productRepository.replaceTaxes(
          tx,
          created.id,
          impuesto_ids
        );

        const product = await productRepository.findById(
          tx,
          company.id,
          created.id
        );

        assert.ok(product);

        const serialized = serializeProduct(product);

        assert.equal(serialized.sku, sku);
        assert.equal(serialized.precio_venta, "125.50");
        assert.equal(serialized.costo_referencia, "85.2500");
        assert.equal(serialized.impuestos.length, 1);

        passed("Producto creado, relacionado y serializado");

        const byBarcode = await productRepository.findByBarcode(
          tx,
          company.id,
          barcode
        );

        assert.equal(byBarcode?.id, created.id);

        passed("Búsqueda por código de barras");

        const listed = await productRepository.list(
          tx,
          company.id,
          productQuerySchema.parse({ sku })
        );

        assert.equal(listed.total, 1);
        assert.equal(listed.rows[0]?.id, created.id);

        passed("Listado y filtros de productos");

        const foreignLookup = await productRepository.findById(
          tx,
          foreign.id,
          created.id
        );

        assert.equal(foreignLookup, null);

        const foreignUpdate = await productRepository.update(
          tx,
          foreign.id,
          created.id,
          { nombre: "Cambio no autorizado" }
        );

        assert.equal(foreignUpdate.count, 0);

        passed("Aislamiento de lectura y escritura entre empresas");

        const locked = await productRepository.lock(
          tx,
          company.id,
          created.id
        );

        assert.equal(locked, true);

        const foreignLock = await productRepository.lock(
          tx,
          foreign.id,
          created.id
        );

        assert.equal(foreignLock, false);

        passed("Bloqueo de producto restringido por empresa");

        await productRepository.update(
          tx,
          company.id,
          created.id,
          {
            nombre: "Producto actualizado",
            precio_venta: "150.00",
          }
        );

        const updated = await productRepository.findById(
          tx,
          company.id,
          created.id
        );

        assert.ok(updated);
        assert.equal(updated.nombre, "Producto actualizado");
        assert.equal(updated.precio_venta.toFixed(2), "150.00");

        passed("Actualización persistida correctamente");

        await productRepository.update(
          tx,
          company.id,
          created.id,
          { activo: false }
        );

        const inactiveBarcode = await productRepository.findByBarcode(
          tx,
          company.id,
          barcode
        );

        assert.equal(inactiveBarcode, null);

        passed("Productos inactivos excluidos de búsqueda por barcode");

        throw rollback;
      }, { timeout: 60000 }),
      (error: unknown) => error === rollback
    );

    const remainingCompanies = await prisma.empresa.count({
      where: {
        razon_social: { startsWith: marker },
      },
    });

    const remainingProducts = await prisma.producto.count({
      where: { sku },
    });

    const remainingUnits = await prisma.unidad_medida.count({
      where: { codigo: sku },
    });

    assert.equal(remainingCompanies, 0);
    assert.equal(remainingProducts, 0);
    assert.equal(remainingUnits, 0);

    passed("Rollback verificado: no quedaron registros sintéticos");

    console.log(`\n${checks} comprobaciones de integración aprobadas.`);
  } finally {
    await prisma.$disconnect();
  }
});
