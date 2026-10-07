import type { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client.js";
import type { createProductSchema, updateProductSchema, productQuerySchema, catalogQuerySchema } from "../product.schema.js";

export type ProductTransaction = Prisma.TransactionClient;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQuery = z.infer<typeof productQuerySchema>;
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CatalogKind = "categories" | "units" | "taxes";
