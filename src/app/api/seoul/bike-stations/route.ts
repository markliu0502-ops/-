import { NextResponse } from "next/server";
import type { BikeStation } from "@/lib/api-contracts";
import {
  apiErrorResponse,
  ApiProviderError,
  fetchProviderJson,
  getServerApiKey,
  invalidQueryResponse,
  isRecord,
  missingApiKeyResponse,
} from "@/lib/server/api-provider";

const PAGE_SIZE = 1_000;
const MAX_ROWS = 4_000;

function coordinate(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBikeRows(payload: unknown): { rows: unknown[]; total: number } {
  const root = isRecord(payload) ? payload : null;
  const container = root && (
    isRecord(root.rentBikeStatus) ? root.rentBikeStatus :
      isRecord(root.bikeList) ? root.bikeList : root
  );
  if (!container) throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);

  const result = isRecord(container.RESULT) ? container.RESULT : null;
  if (result && typeof result.CODE === "string" && result.CODE !== "INFO-000") {
    console.error(`[Seoul Open API] returned provider code ${result.CODE}`);
    throw new ApiProviderError("UPSTREAM_REJECTED", 502);
  }

  const rows = container.row;
  const total = coordinate(container.list_total_count);
  if (!Array.isArray(rows) || total === null) {
    throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
  }
  return { rows, total };
}

async function fetchBikePage(key: string, start: number, end: number) {
  // Seoul's documented bikeList gateway is HTTP-only, so this credentialed call stays server-side.
  const endpoint = new URL(
    `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/bikeList/${start}/${end}/`,
  );
  const payload = await fetchProviderJson(endpoint, {}, "Seoul Open API");
  return getBikeRows(payload);
}

export async function GET(request: Request) {
  const key = getServerApiKey("SEOUL_API_KEY");
  if (!key) return missingApiKeyResponse();

  const params = new URL(request.url).searchParams;
  const lat = params.has("lat") ? coordinate(params.get("lat")) : 37.545;
  const lng = params.has("lng") ? coordinate(params.get("lng")) : 126.97;
  const radius = params.has("radius") ? coordinate(params.get("radius")) : 7_000;
  const limit = params.has("limit") ? coordinate(params.get("limit")) : 80;
  if (
    lat === null || lat < -90 || lat > 90 ||
    lng === null || lng < -180 || lng > 180 ||
    radius === null || radius < 200 || radius > 20_000 ||
    limit === null || limit < 1 || limit > 200
  ) {
    return invalidQueryResponse();
  }

  try {
    const firstPage = await fetchBikePage(key, 1, PAGE_SIZE);
    const maximum = Math.min(firstPage.total, MAX_ROWS);
    const additionalPages: Promise<{ rows: unknown[]; total: number }>[] = [];
    for (let start = PAGE_SIZE + 1; start <= maximum; start += PAGE_SIZE) {
      additionalPages.push(fetchBikePage(key, start, Math.min(start + PAGE_SIZE - 1, maximum)));
    }
    const pages = [firstPage, ...await Promise.all(additionalPages)];

    const stations = pages.flatMap(({ rows }) => rows).flatMap((row, index) => {
      if (!isRecord(row)) return [];
      const stationLat = coordinate(row.stationLatitude);
      const stationLng = coordinate(row.stationLongitude);
      const name = typeof row.stationName === "string" ? row.stationName : "";
      if (
        stationLat === null || stationLat < -90 || stationLat > 90 ||
        stationLng === null || stationLng < -180 || stationLng > 180 ||
        !name
      ) {
        return [];
      }

      const distance = distanceMeters(lat, lng, stationLat, stationLng);
      if (distance > radius) return [];

      return [{
        station: {
          id: String(row.stationId ?? name),
          name,
          address: typeof row.stationAddress1 === "string" && row.stationAddress1
            ? row.stationAddress1
            : name,
          lat: stationLat,
          lng: stationLng,
          bikes: coordinate(row.parkingBikeTotCnt) ?? 0,
          capacity: coordinate(row.rackTotCnt) ?? 0,
          distanceMeters: Math.round(distance),
        } satisfies BikeStation,
        distance,
        index,
      }];
    });

    stations.sort((first, second) => first.distance - second.distance || first.index - second.index);
    return NextResponse.json({
      source: "seoul",
      stations: stations.slice(0, limit).map(({ station }) => station),
    });
  } catch (error) {
    return apiErrorResponse(error, "Seoul Open API");
  }
}
