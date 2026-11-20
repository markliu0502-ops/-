import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  ApiProviderError,
  fetchProviderJson,
  invalidQueryResponse,
  isRecord,
} from "@/lib/server/api-provider";

function coordinate(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function weatherCondition(code: number): string {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code >= 51 && code <= 57) return "이슬비";
  if (code >= 61 && code <= 67) return "비";
  if (code >= 71 && code <= 77) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code === 85 || code === 86) return "눈 소나기";
  if (code >= 95 && code <= 99) return "뇌우";
  return "현재 날씨";
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const hasLatitude = params.has("lat");
  const hasLongitude = params.has("lng");
  const latitude = hasLatitude ? coordinate(params.get("lat")) : 37.5665;
  const longitude = hasLongitude ? coordinate(params.get("lng")) : 126.978;
  if (
    hasLatitude !== hasLongitude ||
    latitude === null || latitude < -90 || latitude > 90 ||
    longitude === null || longitude < -180 || longitude > 180
  ) {
    return invalidQueryResponse();
  }

  const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
  endpoint.searchParams.set("latitude", String(latitude));
  endpoint.searchParams.set("longitude", String(longitude));
  endpoint.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
  );
  endpoint.searchParams.set("timezone", "Asia/Seoul");
  endpoint.searchParams.set("wind_speed_unit", "kmh");

  try {
    const payload = await fetchProviderJson(endpoint, {}, "Open-Meteo");
    const current = isRecord(payload) && isRecord(payload.current) ? payload.current : null;
    const temperatureC = current ? coordinate(current.temperature_2m) : null;
    const apparentTemperatureC = current ? coordinate(current.apparent_temperature) : null;
    const precipitationMm = current ? coordinate(current.precipitation) : null;
    const weatherCode = current ? coordinate(current.weather_code) : null;
    const windSpeedKmh = current ? coordinate(current.wind_speed_10m) : null;
    const observedAt = current && typeof current.time === "string" ? current.time : null;
    if (
      temperatureC === null ||
      apparentTemperatureC === null ||
      precipitationMm === null ||
      weatherCode === null || !Number.isInteger(weatherCode) ||
      windSpeedKmh === null ||
      observedAt === null
    ) {
      throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);
    }

    return NextResponse.json({
      source: "open-meteo",
      weather: {
        temperatureC,
        apparentTemperatureC,
        precipitationMm,
        weatherCode,
        windSpeedKmh,
        condition: weatherCondition(weatherCode),
        observedAt,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Open-Meteo");
  }
}
