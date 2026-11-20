import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  fetchProviderJson,
  getServerApiKey,
  invalidQueryResponse,
  isRecord,
  missingApiKeyResponse,
  ApiProviderError,
} from "@/lib/server/api-provider";
import type { PlaceSearchResult } from "@/lib/api-contracts";

function coordinate(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const key = getServerApiKey("KAKAO_REST_API_KEY");
  if (!key) return missingApiKeyResponse();

  const params = new URL(request.url).searchParams;
  const query = params.get("query")?.trim() ?? "";
  if (!query || query.length > 100) return invalidQueryResponse();

  const endpoint = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("size", "10");

  const lat = params.has("lat") ? coordinate(params.get("lat")) : null;
  const lng = params.has("lng") ? coordinate(params.get("lng")) : null;
  const radius = params.has("radius") ? coordinate(params.get("radius")) : 10_000;
  if (
    (params.has("lat") && (lat === null || lat < -90 || lat > 90)) ||
    (params.has("lng") && (lng === null || lng < -180 || lng > 180)) ||
    (lat === null) !== (lng === null) ||
    radius === null ||
    radius < 0 ||
    radius > 20_000
  ) {
    return invalidQueryResponse();
  }

  if (lat !== null && lng !== null) {
    endpoint.searchParams.set("y", String(lat));
    endpoint.searchParams.set("x", String(lng));
    endpoint.searchParams.set("radius", String(radius));
  }

  try {
    const payload = await fetchProviderJson(
      endpoint,
      { Authorization: `KakaoAK ${key}` },
      "Kakao Local",
    );
    const documents = isRecord(payload) ? payload.documents : null;
    if (!Array.isArray(documents)) {
      throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
    }

    const places: PlaceSearchResult[] = documents.flatMap((item) => {
      if (!isRecord(item)) return [];
      const lat = coordinate(item.y);
      const lng = coordinate(item.x);
      const name = typeof item.place_name === "string" ? item.place_name : "";
      if (lat === null || lng === null || !name) return [];

      return [{
        id: String(item.id ?? `${lng},${lat}`),
        name,
        address: typeof item.road_address_name === "string" && item.road_address_name
          ? item.road_address_name
          : typeof item.address_name === "string" ? item.address_name : "",
        category: typeof item.category_name === "string" ? item.category_name : "",
        lat,
        lng,
      }];
    });

    return NextResponse.json({ source: "kakao", places });
  } catch (error) {
    return apiErrorResponse(error, "Kakao Local");
  }
}
