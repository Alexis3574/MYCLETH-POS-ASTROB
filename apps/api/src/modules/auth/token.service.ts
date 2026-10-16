import {
  SignJWT,
  jwtVerify,
} from "jose";

import { env } from "../../config/env.js";

const secret =
  new TextEncoder().encode(
    env.auth.jwtSecret,
  );

const issuer = "pos-api";
const audience = "pos-web";

interface CreateAccessTokenInput {
  userId: bigint;
  empresaId: bigint;
}

export const tokenService = {
  async createAccessToken(
    input: CreateAccessTokenInput,
  ) {
    const now =
      Math.floor(Date.now() / 1000);

    return new SignJWT({
      empresa_id:
        input.empresaId.toString(),
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "JWT",
      })
      .setSubject(
        input.userId.toString(),
      )
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(
        now +
          env.auth.jwtExpiresInSeconds,
      )
      .sign(secret);
  },

  async verifyAccessToken(
    token: string,
  ) {
    const { payload } =
      await jwtVerify(
        token,
        secret,
        {
          issuer,
          audience,
          algorithms: ["HS256"],
        },
      );

    if (
      !payload.sub ||
      typeof payload.empresa_id !==
        "string"
    ) {
      throw new Error(
        "INVALID_TOKEN_PAYLOAD",
      );
    }

    if (
      !/^\d+$/.test(payload.sub) ||
      !/^\d+$/.test(
        payload.empresa_id,
      )
    ) {
      throw new Error(
        "INVALID_TOKEN_PAYLOAD",
      );
    }

    return {
      userId:
        BigInt(payload.sub),

      empresaId:
        BigInt(
          payload.empresa_id,
        ),
    };
  },
};