export interface LoginCredentials {
  empresa_id: string;
  username: string;
  password: string;
}

export interface AuthRole {
  id: string;
  codigo: string;
  nombre: string;
}

export interface AuthPermission {
  id: string;
  codigo: string;
  modulo: string;
  descripcion: string | null;
}

export interface AuthUser {
  id: string;
  empresa: {
    id: string;
    nombre: string;
  };
  username: string;
  nombre: string;
  apellido: string | null;
  email: string | null;
  telefono: string | null;
  activo: boolean;
  bloqueado: boolean;
  ultimo_acceso: string | null;
  roles: AuthRole[];
  permisos: AuthPermission[];
}

export interface LoginData {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  usuario: AuthUser;
}

export interface ApiSuccess<T> {
  ok: true;
  message?: string;
  data: T;
}

export type LoginResponse = ApiSuccess<LoginData>;

export type MeResponse = ApiSuccess<AuthUser>;
