import { apiRequest } from '../../services/api'

import type {
  AuthUser,
  LoginCredentials,
  LoginData,
  LoginResponse,
  MeResponse,
} from './auth.types'

export const authService = {
  async login(
    credentials: LoginCredentials,
  ): Promise<LoginData> {
    const response = await apiRequest<LoginResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: credentials,
      },
    )

    return response.data
  },

  async getMe(
    token: string,
  ): Promise<AuthUser> {
    const response = await apiRequest<MeResponse>(
      '/auth/me',
      { token },
    )

    return response.data
  },
}
