import { hash } from "bcryptjs";
import { userRepository } from "./user.repository.js";
import type { ChangePasswordInput, CreateUserInput, UpdateUserInput } from "./user.schema.js";

function serializeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        serializeValue(nestedValue),
      ])
    );
  }

  return value;
}

function serializeUser(
  user: object
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(user).map(([key, value]) => [
      key,
      serializeValue(value),
    ])
  );
}

export const userService = {
  async countUsers(): Promise<number> {
    return userRepository.count();
  },

  async listUsers(page: number, limit: number) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const skip = (safePage - 1) * safeLimit;

    const [users, total] = await Promise.all([
      userRepository.findMany({
        skip,
        take: safeLimit,
      }),
      userRepository.count(),
    ]);

    return {
      users: users.map((user) => serializeUser(user)),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  },

  async getUserById(id: bigint) {
    const user = await userRepository.findById(id);

    if (!user) {
      return null;
    }

    return serializeUser(user);
  },

  async createUser(input: CreateUserInput) {
  const empresaId = BigInt(input.empresa_id);

  const company = await userRepository.companyExists(empresaId);

  if (!company) {
    return {
      status: "COMPANY_NOT_FOUND" as const,
    };
  }

  const normalizedUsername = input.username.trim();

  const existingUsername = await userRepository.findByUsername(
    empresaId,
    normalizedUsername
  );

  if (existingUsername) {
    return {
      status: "USERNAME_EXISTS" as const,
    };
  }

  const normalizedEmail = input.email
    ? input.email.trim().toLowerCase()
    : null;

  if (normalizedEmail) {
    const existingEmail = await userRepository.findByEmail(
      empresaId,
      normalizedEmail
    );

    if (existingEmail) {
      return {
        status: "EMAIL_EXISTS" as const,
      };
    }
  }

  const passwordHash = await hash(input.password, 12);

  const user = await userRepository.create({
    empresa_id: empresaId,
    username: normalizedUsername,
    password_hash: passwordHash,
    nombre: input.nombre.trim(),
    apellido: input.apellido?.trim() || null,
    email: normalizedEmail,
    telefono: input.telefono?.trim() || null,
    activo: input.activo ?? true,
  });

  return {
    status: "CREATED" as const,
    user: serializeUser(user),
  };
},
  async updateUser(id: bigint, input: UpdateUserInput) {
  const currentUser = await userRepository.findById(id);

  if (!currentUser) {
    return {
      status: "NOT_FOUND" as const,
    };
  }

  const data: {
    username?: string;
    nombre?: string;
    apellido?: string | null;
    email?: string | null;
    telefono?: string | null;
    activo?: boolean;
  } = {};

  if (input.username !== undefined) {
    const normalizedUsername = input.username.trim();

    if (normalizedUsername !== currentUser.username) {
      const existingUsername = await userRepository.findByUsername(
        currentUser.empresa_id,
        normalizedUsername
      );

      if (existingUsername && existingUsername.id !== id) {
        return {
          status: "USERNAME_EXISTS" as const,
        };
      }
    }

    data.username = normalizedUsername;
  }

  if (input.nombre !== undefined) {
    data.nombre = input.nombre.trim();
  }

  if (input.apellido !== undefined) {
    data.apellido = input.apellido?.trim() || null;
  }

  if (input.email !== undefined) {
    const normalizedEmail =
      input.email === null
        ? null
        : input.email.trim().toLowerCase();

    if (
      normalizedEmail &&
      normalizedEmail !== currentUser.email?.toLowerCase()
    ) {
      const existingEmail = await userRepository.findByEmail(
        currentUser.empresa_id,
        normalizedEmail
      );

      if (existingEmail && existingEmail.id !== id) {
        return {
          status: "EMAIL_EXISTS" as const,
        };
      }
    }

    data.email = normalizedEmail;
  }

  if (input.telefono !== undefined) {
    data.telefono = input.telefono?.trim() || null;
  }

  if (input.activo !== undefined) {
    data.activo = input.activo;
  }

  const updatedUser = await userRepository.update(id, data);

  return {
    status: "UPDATED" as const,
    user: serializeUser(updatedUser),
  };
},

  async changePassword(
  id: bigint,
  input: ChangePasswordInput
) {
  const user = await userRepository.findById(id);

  if (!user) {
    return {
      status: "NOT_FOUND" as const,
    };
  }

  const passwordHash = await hash(input.password, 12);

  await userRepository.updatePassword(
    id,
    passwordHash
  );

  return {
    status: "UPDATED" as const,
  };
},
};