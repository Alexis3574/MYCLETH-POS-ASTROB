import {
  compare,
} from "bcryptjs";

import {
  env,
} from "../../config/env.js";

import {
  authRepository,
} from "./auth.repository.js";

import {
  tokenService,
} from "./token.service.js";

function serializeUser(
  user: Awaited<
    ReturnType<
      typeof authRepository.findById
    >
  >,
) {
  if (!user) {
    throw new Error(
      "USER_NOT_FOUND",
    );
  }

  const permissions =
    new Map<
      string,
      {
        id: string;
        codigo: string;
        modulo: string;
        descripcion: string | null;
      }
    >();

  const roles =
    user.usuario_rol.map(
      (assignment) => {
        for (
          const rolePermission
          of assignment.rol
            .rol_permiso
        ) {
          const permission =
            rolePermission.permiso;

          permissions.set(
            permission.codigo,
            {
              id:
                permission.id.toString(),

              codigo:
                permission.codigo,

              modulo:
                permission.modulo,

              descripcion:
                permission.descripcion,
            },
          );
        }

        return {
          id:
            assignment.rol.id.toString(),

          codigo:
            assignment.rol.codigo,

          nombre:
            assignment.rol.nombre,
        };
      },
    );

  return {
    id: user.id.toString(),

    empresa: {
      id:
        user.empresa.id.toString(),

      nombre:
        user.empresa
          .nombre_comercial,
    },

    username:
      user.username,

    nombre:
      user.nombre,

    apellido:
      user.apellido,

    email:
      user.email,

    telefono:
      user.telefono,

    activo:
      user.activo,

    bloqueado:
      user.bloqueado,

    ultimo_acceso:
      user.ultimo_acceso,

    roles,

    permisos:
      Array.from(
        permissions.values(),
      ),
  };
}

export const authService = {
  async login(input: {
    empresaId: bigint;
    username: string;
    password: string;
  }) {
    const user =
      await authRepository.findByUsername(
        input.empresaId,
        input.username,
      );

    if (!user) {
      throw new Error(
        "INVALID_CREDENTIALS",
      );
    }

    if (
      !user.activo ||
      !user.empresa.activo
    ) {
      throw new Error(
        "ACCOUNT_INACTIVE",
      );
    }

    if (user.bloqueado) {
      throw new Error(
        "ACCOUNT_BLOCKED",
      );
    }

    const passwordMatches =
      await compare(
        input.password,
        user.password_hash,
      );

    if (!passwordMatches) {
      const failed =
        await authRepository.registerFailedAttempt(
          user.id,
        );

      if (
        failed.intentos_fallidos >=
        env.auth.maxFailedAttempts
      ) {
        await authRepository.blockUser(
          user.id,
        );

        throw new Error(
          "ACCOUNT_BLOCKED",
        );
      }

      throw new Error(
        "INVALID_CREDENTIALS",
      );
    }

    await authRepository.registerSuccessfulLogin(
      user.id,
    );

    const token =
      await tokenService.createAccessToken({
        userId: user.id,
        empresaId:
          user.empresa_id,
      });

    const refreshed =
      await authRepository.findById(
        user.id,
      );

    return {
      access_token: token,
      token_type: "Bearer",
      expires_in:
        env.auth.jwtExpiresInSeconds,

      usuario:
        serializeUser(
          refreshed,
        ),
    };
  },

  async getMe(userId: bigint) {
    const user =
      await authRepository.findById(
        userId,
      );

    if (!user) {
      throw new Error(
        "USER_NOT_FOUND",
      );
    }

    return serializeUser(user);
  },
};