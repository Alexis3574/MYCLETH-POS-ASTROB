import { env } from "../../config/env.js";

export class EcommerceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "EcommerceApiError";
  }
}

interface EcommerceRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}

export interface EcommerceHttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

async function performEcommerceRequest<T>(
  path: string,
  options: EcommerceRequestOptions = {},
): Promise<EcommerceHttpResponse<T>> {
  if (!env.ecommerce.apiKey) {
    throw new Error(
      "ECOMMERCE_API_KEY is not configured",
    );
  }

  const normalizedPath = path.startsWith("/")
    ? path
    : `/${path}`;

  const response = await fetch(
    `${env.ecommerce.baseUrl}${normalizedPath}`,
    {
      method: options.method ?? "GET",

      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": env.ecommerce.apiKey,
      },

      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),

      signal: AbortSignal.timeout(
        env.ecommerce.timeoutMs,
      ),
    },
  );

  const contentType =
    response.headers.get("content-type") ?? "";

  const responseBody = contentType.includes(
    "application/json",
  )
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new EcommerceApiError(
      `E-commerce API request failed with status ${response.status}`,
      response.status,
      responseBody,
    );
  }

  return {
    data: responseBody as T,
    status: response.status,
    headers: response.headers,
  };
}

export async function ecommerceRequestWithMeta<T>(
  path: string,
  options: EcommerceRequestOptions = {},
): Promise<EcommerceHttpResponse<T>> {
  return performEcommerceRequest<T>(
    path,
    options,
  );
}

export async function ecommerceRequest<T>(
  path: string,
  options: EcommerceRequestOptions = {},
): Promise<T> {
  const response =
    await performEcommerceRequest<T>(
      path,
      options,
    );

  return response.data;
}