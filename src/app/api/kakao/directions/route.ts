import { NextResponse } from "next/server";
import type { KakaoCarRoute, KakaoCarRoutePriority } from "@/lib/api-contracts";
import {
  apiErrorResponse,
  ApiProviderError,
  fetchProviderJson,
  getServerApiKey,
  invalidQueryResponse,
  isRecord,
  missingApiKeyResponse,
} from "@/lib/server/api-provider";

function coordinate(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRoute(payload: unknown, priority: KakaoCarRoutePriority): KakaoCarRoute {
  const routes = isRecord(payload) ? payload.routes : null;
  const route = Array.isArray(routes) && isRecord(routes[0]) ? routes[0] : null;
  if (!route) throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
  if (route.result_code !== 0) {
    console.error(`[Kakao Mobility] Directions returned route result ${String(route.result_code)}`);
    throw new ApiProviderError("ROUTE_NOT_FOUND", 502);
  }

  const summary = isRecord(route.summary) ? route.summary : null;
  const distanceMeters = summary ? coordinate(summary.distance) : null;
  const durationSeconds = summary ? coordinate(summary.duration) : null;
  if (distanceMeters === null || durationSeconds === null || distanceMeters < 0 || durationSeconds < 0) {
    throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
  }

  const path: KakaoCarRoute["path"] = [];
  const sections = Array.isArray(route.sections) ? route.sections : [];
  for (const section of sections) {
    if (!isRecord(section) || !Array.isArray(section.roads)) continue;
    for (const road of section.roads) {
      if (!isRecord(road) || !Array.isArray(road.vertexes)) continue;
      for (let index = 0; index + 1 < road.vertexes.length; index += 2) {
        const lng = coordinate(road.vertexes[index]);
        const lat = coordinate(road.vertexes[index + 1]);
        if (lng === null || lng < -180 || lng > 180 || lat === null || lat < -90 || lat > 90) {
          throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
        }
        path.push({ lat, lng });
      }
    }
  }

  if (path.length < 2) throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
  return { priority, distanceMeters, durationSeconds, path };
}

export async function GET(request: Request) {
  const key = getServerApiKey("KAKAO_REST_API_KEY");
  if (!key) return missingApiKeyResponse();

  const params = new URL(request.url).searchParams;
  const originLat = coordinate(params.get("originLat"));
  const originLng = coordinate(params.get("originLng"));
  const destinationLat = coordinate(params.get("destinationLat"));
  const destinationLng = coordinate(params.get("destinationLng"));
  const priority = params.get("priority");
  if (
    originLat === null || originLat < -90 || originLat > 90 ||
    originLng === null || originLng < -180 || originLng > 180 ||
    destinationLat === null || destinationLat < -90 || destinationLat > 90 ||
    destinationLng === null || destinationLng < -180 || destinationLng > 180 ||
    (priority !== "RECOMMEND" && priority !== "DISTANCE")
  ) {
    return invalidQueryResponse();
  }

  const routePriority: KakaoCarRoutePriority = priority;
  const endpoint = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  endpoint.searchParams.set("origin", `${originLng},${originLat}`);
  endpoint.searchParams.set("destination", `${destinationLng},${destinationLat}`);
  endpoint.searchParams.set("priority", routePriority);
  endpoint.searchParams.set("alternatives", "false");
  endpoint.searchParams.set("summary", "false");

  try {
    const payload = await fetchProviderJson(
      endpoint,
      {
        Authorization: `KakaoAK ${key}`,
        "Content-Type": "application/json",
      },
      "Kakao Mobility Directions",
    );
    return NextResponse.json({
      source: "kakao-mobility",
      route: parseRoute(payload, routePriority),
    });
  } catch (error) {
    return apiErrorResponse(error, "Kakao Mobility Directions");
  }
}
