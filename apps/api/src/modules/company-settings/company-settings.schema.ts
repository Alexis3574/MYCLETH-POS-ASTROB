import { z } from "zod";

export const settingKeys = [
  "ventas",
  "inventario",
  "comprobantes",
  "interfaz",
] as const;

export type SettingKey = typeof settingKeys[number];

export const settingKeySchema = z.enum(settingKeys);

export const updateSettingSchema = z.strictObject({
  valor: z.unknown(),
});

const schemas = {
  ventas: z.strictObject({
    confirmar_antes_de_cobrar: z.boolean(),
    mostrar_resumen_impuestos: z.boolean(),
    solicitar_cliente_en_venta: z.boolean(),
  }),

  inventario: z.strictObject({
    mostrar_alertas_stock_bajo: z.boolean(),
    umbral_stock_bajo: z.number().int().min(0).max(1000000),
  }),

  comprobantes: z.strictObject({
    mostrar_rfc: z.boolean(),
    mostrar_direccion: z.boolean(),
    leyenda_ticket: z.string().trim().max(300),
  }),

  interfaz: z.strictObject({
    pagina_inicial: z.enum(["ventas", "dashboard"]),
    elementos_por_pagina: z.number().int().min(10).max(100),
    mostrar_sugerencias: z.boolean(),
  }),
};

export const settingDefaults = {
  ventas: {
    confirmar_antes_de_cobrar: true,
    mostrar_resumen_impuestos: true,
    solicitar_cliente_en_venta: false,
  },
  inventario: {
    mostrar_alertas_stock_bajo: true,
    umbral_stock_bajo: 5,
  },
  comprobantes: {
    mostrar_rfc: true,
    mostrar_direccion: true,
    leyenda_ticket: "",
  },
  interfaz: {
    pagina_inicial: "ventas",
    elementos_por_pagina: 25,
    mostrar_sugerencias: true,
  },
} satisfies Record<SettingKey, Record<string, string | boolean | number>>;

export const settingDescriptions: Record<SettingKey, string> = {
  ventas: "Preferencias de presentación y captura de ventas.",
  inventario: "Preferencias de visualización del inventario.",
  comprobantes: "Preferencias de presentación de comprobantes.",
  interfaz: "Preferencias de interfaz del punto de venta.",
};

export function parseSettingValue(
  key: SettingKey,
  value: unknown,
): Record<string, string | number | boolean> {
  return schemas[key].parse(value) as Record<
    string,
    string | number | boolean
  >;
}
