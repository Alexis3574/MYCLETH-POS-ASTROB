-- POSMYCLETH M11: policy is one accepted quotation -> at most one order,
-- and one order -> at most one sale. PostgreSQL UNIQUE allows multiple NULLs.
-- Apply only through the reviewed Prisma migration process, after preflight.
-- No DROP, TRUNCATE, UPDATE or DELETE.
CREATE UNIQUE INDEX "uq_orden_venta_cotizacion_id"
  ON "pos"."orden_venta" ("cotizacion_id");

CREATE UNIQUE INDEX "uq_venta_orden_venta_id"
  ON "pos"."venta" ("orden_venta_id");
