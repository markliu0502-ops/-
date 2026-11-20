export type PlaceSearchResult = {
  id: string;
  name: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
};

export type BikeStation = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  bikes: number;
  capacity: number;
  distanceMeters: number;
};

export type KakaoCarRoutePriority = "RECOMMEND" | "DISTANCE";

export type KakaoCarRoute = {
  priority: KakaoCarRoutePriority;
  distanceMeters: number;
  durationSeconds: number;
  path: Array<{ lat: number; lng: number }>;
};

export type BicycleIncident = {
  id: string;
  title: string;
  address: string;
  lat: number;
  lng: number;
  level: string;
};

export type CurrentWeather = {
  temperatureC: number;
  apparentTemperatureC: number;
  precipitationMm: number;
  weatherCode: number;
  windSpeedKmh: number;
  condition: string;
  observedAt: string;
};

export function isBikeStation(value: unknown): value is BikeStation {
  if (typeof value !== "object" || value === null) return false;
  const station = value as Record<string, unknown>;
  return typeof station.id === "string" &&
    typeof station.name === "string" &&
    typeof station.address === "string" &&
    typeof station.lat === "number" && Number.isFinite(station.lat) &&
    typeof station.lng === "number" && Number.isFinite(station.lng) &&
    typeof station.bikes === "number" && Number.isFinite(station.bikes) &&
    typeof station.capacity === "number" && Number.isFinite(station.capacity) &&
    typeof station.distanceMeters === "number" && Number.isFinite(station.distanceMeters);
}

export function isKakaoCarRoute(value: unknown): value is KakaoCarRoute {
  if (typeof value !== "object" || value === null) return false;
  const route = value as Record<string, unknown>;
  return (route.priority === "RECOMMEND" || route.priority === "DISTANCE") &&
    typeof route.distanceMeters === "number" && Number.isFinite(route.distanceMeters) &&
    typeof route.durationSeconds === "number" && Number.isFinite(route.durationSeconds) &&
    Array.isArray(route.path) && route.path.length >= 2 &&
    route.path.every((point) => {
      if (typeof point !== "object" || point === null) return false;
      const coordinate = point as Record<string, unknown>;
      return typeof coordinate.lat === "number" && Number.isFinite(coordinate.lat) &&
        typeof coordinate.lng === "number" && Number.isFinite(coordinate.lng);
    });
}

export function isBicycleIncident(value: unknown): value is BicycleIncident {
  if (typeof value !== "object" || value === null) return false;
  const incident = value as Record<string, unknown>;
  return typeof incident.id === "string" &&
    typeof incident.title === "string" &&
    typeof incident.address === "string" &&
    typeof incident.lat === "number" && Number.isFinite(incident.lat) &&
    typeof incident.lng === "number" && Number.isFinite(incident.lng) &&
    typeof incident.level === "string";
}

export function isCurrentWeather(value: unknown): value is CurrentWeather {
  if (typeof value !== "object" || value === null) return false;
  const weather = value as Record<string, unknown>;
  return typeof weather.temperatureC === "number" && Number.isFinite(weather.temperatureC) &&
    typeof weather.apparentTemperatureC === "number" && Number.isFinite(weather.apparentTemperatureC) &&
    typeof weather.precipitationMm === "number" && Number.isFinite(weather.precipitationMm) &&
    typeof weather.weatherCode === "number" && Number.isInteger(weather.weatherCode) &&
    typeof weather.windSpeedKmh === "number" && Number.isFinite(weather.windSpeedKmh) &&
    typeof weather.condition === "string" &&
    typeof weather.observedAt === "string" && weather.observedAt.length > 0;
}

export function isPlaceSearchResult(value: unknown): value is PlaceSearchResult {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Record<string, unknown>;
  return typeof place.id === "string" &&
    typeof place.name === "string" &&
    typeof place.address === "string" &&
    typeof place.category === "string" &&
    typeof place.lat === "number" && Number.isFinite(place.lat) &&
    typeof place.lng === "number" && Number.isFinite(place.lng);
}
