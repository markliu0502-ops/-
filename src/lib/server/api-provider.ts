import { NextResponse } from "next/server";

type ServerApiKey = "SEOUL_API_KEY" | "DATA_GO_KR_API_KEY" | "KAKAO_REST_API_KEY";

export class ApiProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function getServerApiKey(name: ServerApiKey): string | null {
  return process.env[name]?.trim() || null;
}

export async function fetchProviderJson(
  url: URL,
  headers: HeadersInit,
  provider: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`[${provider}] request failed (${errorName})`);
    throw new ApiProviderError("UPSTREAM_UNAVAILABLE", 502);
  }

  if (!response.ok) {
    console.error(`[${provider}] returned HTTP ${response.status}`);
    throw new ApiProviderError("UPSTREAM_REJECTED", 502);
  }

  try {
    return await response.json() as unknown;
  } catch {
    console.error(`[${provider}] returned an invalid JSON response`);
    throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
  }
}

export function apiErrorResponse(error: unknown, provider: string) {
  if (error instanceof ApiProviderError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }

  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(`[${provider}] internal error (${errorName})`);
  return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
}

export function missingApiKeyResponse() {
  return NextResponse.json({ error: "API_NOT_CONFIGURED" }, { status: 503 });
}

export function invalidQueryResponse() {
  return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
