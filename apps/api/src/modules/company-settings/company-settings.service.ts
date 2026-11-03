import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  settingKeys,
  settingDefaults,
  settingDescriptions,
  parseSettingValue,
  type SettingKey,
} from "./company-settings.schema.js";

export interface SettingsActor {
  empresaId: bigint;
  userId: bigint;
}

export class SettingsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type SettingRow = Awaited<
  ReturnType<typeof prisma.configuracion_empresa.findUnique>
>;

function serialize(
  key: SettingKey,
  row: SettingRow,
) {
  return {
    id: row?.id.toString() ?? null,
    clave: key,
    valor: parseSettingValue(
      key,
      row ? row.valor : settingDefaults[key],
    ),
    descripcion: settingDescriptions[key],
    personalizado: row !== null,
    actualizado_en: row?.actualizado_en.toISOString() ?? null,
  };
}

async function ensureCompany(actor: SettingsActor) {
  const company = await prisma.empresa.findFirst({
    where: {
      id: actor.empresaId,
      activo: true,
    },
    select: { id: true },
  });

  if (!company) {
    throw new SettingsError(
      403,
      "SETTINGS_COMPANY_FORBIDDEN",
      "La empresa no está disponible.",
    );
  }
}

export const companySettingsService = {
  async list(actor: SettingsActor) {
    await ensureCompany(actor);

    const records = await prisma.configuracion_empresa.findMany({
      where: {
        empresa_id: actor.empresaId,
        clave: { in: [...settingKeys] },
      },
    });

    const byKey = new Map(records.map(row => [row.clave, row]));

    return settingKeys.map(key => serialize(
      key,
      byKey.get(key) ?? null,
    ));
  },

  async get(actor: SettingsActor, key: SettingKey) {
    await ensureCompany(actor);

    const record = await prisma.configuracion_empresa.findUnique({
      where: {
        empresa_id_clave: {
          empresa_id: actor.empresaId,
          clave: key,
        },
      },
    });

    return serialize(key, record);
  },

  async update(
    actor: SettingsActor,
    key: SettingKey,
    rawValue: unknown,
  ) {
    const value = parseSettingValue(key, rawValue);

    return prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id
        FROM "pos"."empresa"
        WHERE id = ${actor.empresaId}
          AND activo = TRUE
        FOR UPDATE
      `;

      if (!rows.length) {
        throw new SettingsError(
          403,
          "SETTINGS_COMPANY_FORBIDDEN",
          "La empresa no está disponible.",
        );
      }

      const where = {
        empresa_id_clave: {
          empresa_id: actor.empresaId,
          clave: key,
        },
      };

      const previous = await tx.configuracion_empresa.findUnique({
        where,
      });

      const record = await tx.configuracion_empresa.upsert({
        where,
        create: {
          empresa_id: actor.empresaId,
          clave: key,
          valor: value as Prisma.InputJsonValue,
          descripcion: settingDescriptions[key],
        },
        update: {
          valor: value as Prisma.InputJsonValue,
          descripcion: settingDescriptions[key],
          actualizado_en: new Date(),
        },
      });

      await tx.auditoria.create({
        data: {
          usuario_id: actor.userId,
          tabla: "configuracion_empresa",
          registro_id: record.id,
          accion: previous ? "UPDATE" : "INSERT",
          datos_nuevos: {
            clave: key,
            operacion: previous ? "ACTUALIZAR" : "CREAR",
          },
        },
      });

      return serialize(key, record);
    }, {
      isolationLevel: "ReadCommitted",
      timeout: 15000,
    });
  },
};
