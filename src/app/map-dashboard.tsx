"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  isBikeStation,
  isBicycleIncident,
  isCurrentWeather,
  isKakaoCarRoute,
  isPlaceSearchResult,
  type BikeStation,
  type BicycleIncident,
  type CurrentWeather,
  type KakaoCarRoute,
  type PlaceSearchResult,
} from "@/lib/api-contracts";

type Place = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

type Endpoint = "origin" | "destination";

const initialOrigin: Place = {
  name: "서울시청",
  address: "서울 중구 세종대로 110",
  lat: 37.5665,
  lng: 126.978,
};

const initialDestination: Place = {
  name: "여의도 한강공원",
  address: "서울 영등포구 여의동로 330",
  lat: 37.5283,
  lng: 126.9328,
};

type DataLoadState = "loading" | "api" | "empty" | "error";
type RouteLoadState = "idle" | "loading" | "ready" | "error";
type IncidentRouteProximity = BicycleIncident & {
  distanceToRouteMeters: number | null;
  nearestRoutePriority: KakaoCarRoute["priority"] | null;
};

const ROUTE_INCIDENT_RADIUS_METERS = 500;

function getDemoMapPosition(latitude: number, longitude: number) {
  const x = Math.max(2, Math.min(98, ((longitude - 126.85) / 0.31) * 100));
  const y = Math.max(2, Math.min(98, ((37.62 - latitude) / 0.15) * 100));
  return { x: (x / 100) * 1000, y: (y / 100) * 700, left: `${x}%`, top: `${y}%` };
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters < 1_000
    ? `${distanceMeters}m`
    : `${(distanceMeters / 1_000).toFixed(1)}km`;
}

function formatRetrievedAt(value: string | null): string {
  if (!value) return "미조회";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function formatDataTime(value: string | null, state: DataLoadState | RouteLoadState): string {
  if (value) return `${formatRetrievedAt(value)} KST`;
  if (state === "loading") return "조회 중";
  if (state === "error") return "조회 실패";
  return "미조회";
}

function getApiErrorCode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const code = (payload as Record<string, unknown>).error;
  return typeof code === "string" ? code : null;
}

function getProviderErrorMessage(provider: string, code: string | null): string {
  if (code === "API_NOT_CONFIGURED") {
    return `${provider} 서버 API 키가 설정되지 않았어요. 환경변수를 확인해 주세요.`;
  }
  if (code === "UPSTREAM_REJECTED") {
    if (provider === "날씨") {
      return "날씨 제공처가 요청을 거부했어요. 호출 한도나 제공처 상태를 확인해 주세요.";
    }
    return `${provider} API 요청이 거부됐어요. 인증 키, 서비스 권한, 호출 한도 또는 허용 IP·도메인을 확인해 주세요.`;
  }
  if (code === "UPSTREAM_UNAVAILABLE") {
    return `${provider} API에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.`;
  }
  if (code === "UPSTREAM_INVALID_RESPONSE") {
    return `${provider} API 응답 형식이 올바르지 않아요.`;
  }
  if (code === "INVALID_QUERY") {
    return `${provider} 요청 정보가 올바르지 않아요.`;
  }
  return `${provider} 정보를 불러오지 못했어요.`;
}

function getWeatherIcon(code: number): string {
  if (code === 0) return "☀";
  if (code <= 2) return "⛅";
  if (code === 3) return "☁";
  if (code === 45 || code === 48) return "〰";
  if (code >= 71 && code <= 86) return "❄";
  if (code >= 95) return "⚡";
  if (code >= 51 && code <= 82) return "☂";
  return "◌";
}

function distanceFromIncidentToRoute(incident: BicycleIncident, route: KakaoCarRoute): number {
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(incident.lat * Math.PI / 180);
  let minimumDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index + 1 < route.path.length; index += 1) {
    const start = route.path[index];
    const end = route.path[index + 1];
    const startX = (start.lng - incident.lng) * metersPerDegreeLongitude;
    const startY = (start.lat - incident.lat) * metersPerDegreeLatitude;
    const endX = (end.lng - incident.lng) * metersPerDegreeLongitude;
    const endY = (end.lat - incident.lat) * metersPerDegreeLatitude;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
    const projection = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / segmentLengthSquared));
    const closestX = startX + projection * deltaX;
    const closestY = startY + projection * deltaY;
    minimumDistance = Math.min(minimumDistance, Math.hypot(closestX, closestY));
  }

  return minimumDistance;
}

export default function MapDashboard() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const routeRequestRef = useRef<AbortController | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(() =>
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY
      ? ""
      : "카카오 지도 키가 설정되지 않았어요. .env.local에 NEXT_PUBLIC_KAKAO_JS_KEY를 추가해 주세요.",
  );
  const [origin, setOrigin] = useState<Place>(initialOrigin);
  const [destination, setDestination] = useState<Place>(initialDestination);
  const [activeSearch, setActiveSearch] = useState<Endpoint | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [stations, setStations] = useState<BikeStation[]>([]);
  const [carRoutes, setCarRoutes] = useState<KakaoCarRoute[]>([]);
  const [routeLoadState, setRouteLoadState] = useState<RouteLoadState>("idle");
  const [routeMessage, setRouteMessage] = useState("");
  const [incidents, setIncidents] = useState<BicycleIncident[]>([]);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [weatherDataState, setWeatherDataState] = useState<DataLoadState>("loading");
  const [weatherErrorMessage, setWeatherErrorMessage] = useState("");
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0);
  const [stationRetrievedAt, setStationRetrievedAt] = useState<string | null>(null);
  const [routeRetrievedAt, setRouteRetrievedAt] = useState<string | null>(null);
  const [incidentRetrievedAt, setIncidentRetrievedAt] = useState<string | null>(null);
  const [stationDataState, setStationDataState] = useState<DataLoadState>("loading");
  const [incidentDataState, setIncidentDataState] = useState<DataLoadState>("loading");
  const [incidentYear, setIncidentYear] = useState<number | null>(null);
  const [stationErrorMessage, setStationErrorMessage] = useState("");
  const [incidentErrorMessage, setIncidentErrorMessage] = useState("");
  const selectedBikeStation = stations.find((station) => station.id === selectedStation);
  const incidentsWithProximity = useMemo<IncidentRouteProximity[]>(() => incidents.map((incident) => {
    if (carRoutes.length === 0) {
      return { ...incident, distanceToRouteMeters: null, nearestRoutePriority: null };
    }
    const nearest = carRoutes
      .map((route) => ({ route, distance: distanceFromIncidentToRoute(incident, route) }))
      .reduce((first, second) => first.distance <= second.distance ? first : second);
    return {
      ...incident,
      distanceToRouteMeters: nearest.distance,
      nearestRoutePriority: nearest.route.priority,
    };
  }), [incidents, carRoutes]);
  const incidentsNearRoute = useMemo(
    () => incidentsWithProximity
      .filter((incident) => incident.distanceToRouteMeters !== null &&
        incident.distanceToRouteMeters <= ROUTE_INCIDENT_RADIUS_METERS)
      .sort((first, second) =>
        (first.distanceToRouteMeters ?? Number.POSITIVE_INFINITY) -
        (second.distanceToRouteMeters ?? Number.POSITIVE_INFINITY),
      ),
    [incidentsWithProximity],
  );
  const routeComparisons = useMemo(
    () => carRoutes.map((route) => ({
      route,
      nearbyIncidentCount: incidents.reduce(
        (count, incident) => count +
          Number(distanceFromIncidentToRoute(incident, route) <= ROUTE_INCIDENT_RADIUS_METERS),
        0,
      ),
    })),
    [carRoutes, incidents],
  );

  const resetCarRoutes = useCallback(() => {
    routeRequestRef.current?.abort();
    routeRequestRef.current = null;
    setCarRoutes([]);
    setRouteRetrievedAt(null);
    setRouteLoadState("idle");
    setRouteMessage("");
  }, []);

  useEffect(() => () => routeRequestRef.current?.abort(), []);

  useEffect(() => {
    const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!appKey) return;

    let cancelled = false;
    const scriptId = "kakao-maps-sdk";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    const onLoad = () => {
      if (!window.kakao?.maps) {
        setMapError("카카오 지도 SDK를 불러오지 못했어요. Kakao Developers에서 OPEN_MAP_AND_LOCAL 서비스를 활성화하고 앱 키와 도메인을 확인해 주세요.");
        return;
      }
      window.kakao.maps.load(() => {
        if (!cancelled) setSdkReady(true);
      });
    };
    const onError = () => {
      if (!cancelled) setMapError("카카오 지도 SDK 요청이 거부됐어요. Kakao Developers에서 OPEN_MAP_AND_LOCAL 서비스를 활성화하고 앱 키와 도메인을 확인해 주세요.");
    };

    if (window.kakao?.maps) {
      onLoad();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.async = true;
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
        document.head.appendChild(script);
      }
      if (script.dataset.loaded === "true") {
        onLoad();
      } else {
        script.addEventListener("load", onLoad);
        script.addEventListener("error", onError);
        script.addEventListener("load", () => {
          script?.setAttribute("data-loaded", "true");
        }, { once: true });
      }
    }

    return () => {
      cancelled = true;
      script?.removeEventListener("load", onLoad);
      script?.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadWeather = async () => {
      setWeather(null);
      setWeatherErrorMessage("");
      setWeatherDataState("loading");
      try {
        const params = new URLSearchParams({
          lat: String(origin.lat),
          lng: String(origin.lng),
        });
        const response = await fetch(`/api/weather?${params}`, { signal: controller.signal });
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(getProviderErrorMessage("날씨", getApiErrorCode(payload)));
        }
        const value = typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>).weather
          : null;
        if (!isCurrentWeather(value)) {
          throw new Error("날씨 API 응답 형식이 올바르지 않아요.");
        }
        if (cancelled) return;
        setWeather(value);
        setWeatherDataState("api");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setWeather(null);
        setWeatherErrorMessage(error instanceof Error
          ? error.message
          : getProviderErrorMessage("날씨", null));
        setWeatherDataState("error");
      }
    };

    void loadWeather();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [origin.lat, origin.lng, weatherRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadStations = async () => {
      try {
        const params = new URLSearchParams({
          lat: String(origin.lat),
          lng: String(origin.lng),
          radius: "5000",
          limit: "40",
        });
        const response = await fetch(`/api/seoul/bike-stations?${params}`, {
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(getProviderErrorMessage("서울 따릉이", getApiErrorCode(payload)));
        }
        if (typeof payload !== "object" || payload === null) {
          throw new Error("서울 따릉이 API 응답 형식이 올바르지 않아요.");
        }

        const values = (payload as Record<string, unknown>).stations;
        if (!Array.isArray(values) || !values.every(isBikeStation)) {
          throw new Error("서울 따릉이 API 응답 형식이 올바르지 않아요.");
        }
        if (cancelled) return;
        setStations(values);
        setStationRetrievedAt(new Date().toISOString());
        setStationDataState(values.length > 0 ? "api" : "empty");
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setStations([]);
          setStationRetrievedAt(null);
          setStationErrorMessage(error instanceof Error
            ? error.message
            : getProviderErrorMessage("서울 따릉이", null));
          setStationDataState("error");
        }
      }
    };

    void loadStations();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [origin.lat, origin.lng]);

  useEffect(() => {
    let cancelled = false;

    const loadIncidents = async () => {
      try {
        const response = await fetch("/api/data/bicycle-incidents");
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(getProviderErrorMessage("한국도로교통공단 사고다발지역", getApiErrorCode(payload)));
        }
        if (typeof payload !== "object" || payload === null) {
          throw new Error("사고다발지역 API 응답 형식이 올바르지 않아요.");
        }

        const values = (payload as Record<string, unknown>).incidents;
        if (!Array.isArray(values) || !values.every(isBicycleIncident)) {
          throw new Error("사고다발지역 API 응답 형식이 올바르지 않아요.");
        }
        const year = (payload as Record<string, unknown>).year;
        if (typeof year !== "number" || !Number.isInteger(year)) {
          throw new Error("사고다발지역 API 응답의 기준연도가 올바르지 않아요.");
        }
        if (cancelled) return;
        setIncidentYear(year);
        setIncidents(values);
        setIncidentRetrievedAt(new Date().toISOString());
        setIncidentDataState(values.length > 0 ? "api" : "empty");
      } catch (error) {
        if (!cancelled) {
          setIncidents([]);
          setIncidentYear(null);
          setIncidentRetrievedAt(null);
          setIncidentErrorMessage(error instanceof Error
            ? error.message
            : getProviderErrorMessage("한국도로교통공단 사고다발지역", null));
          setIncidentDataState("error");
        }
      }
    };

    void loadIncidents();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const maps = window.kakao?.maps;
    if (!sdkReady || !maps || !mapElement.current || mapRef.current) return;

    mapRef.current = new maps.Map(mapElement.current, {
      center: new maps.LatLng(initialOrigin.lat, initialOrigin.lng),
      level: 7,
    });
    setMapReady(true);
  }, [sdkReady]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.kakao?.maps;
    if (!mapReady || !map || !maps) return;
    map.setCenter(new maps.LatLng(origin.lat, origin.lng));
  }, [mapReady, origin.lat, origin.lng]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.kakao?.maps;
    if (!map || !maps) return;

    const overlays: KakaoOverlay[] = [];

    if (showStations) {
      stations.forEach((station) => {
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = "map-marker station-marker";
        marker.textContent = String(station.bikes);
        marker.title = `${station.name} · 대여 가능 ${station.bikes}대`;
        marker.setAttribute("aria-label", marker.title);
        marker.addEventListener("click", () => {
          setSelectedStation(station.id);
          resetCarRoutes();
        });
        overlays.push(
          new maps.CustomOverlay({
            position: new maps.LatLng(station.lat, station.lng),
            content: marker,
            yAnchor: 1,
            zIndex: 5,
            map,
          }),
        );
      });
    }

    if (showIncidents) {
      incidentsWithProximity.forEach((incident) => {
        const distanceToRoute = incident.distanceToRouteMeters;
        const nearRoute = distanceToRoute !== null && distanceToRoute <= ROUTE_INCIDENT_RADIUS_METERS;
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = `map-marker incident-marker ${nearRoute ? "near-route" : ""}`;
        marker.textContent = "!";
        marker.title = `${incident.title} · ${incident.address} · ${incidentYear}년 기준 과거 사고정보${
          nearRoute ? ` · 자동차 경로에서 ${Math.round(distanceToRoute)}m` : ""
        }`;
        marker.setAttribute("aria-label", marker.title);
        overlays.push(
          new maps.CustomOverlay({
            position: new maps.LatLng(incident.lat, incident.lng),
            content: marker,
            yAnchor: 1,
            zIndex: nearRoute ? 12 : 10,
            map,
          }),
        );
      });
    }

    return () => overlays.forEach((overlay) => overlay.setMap(null));
  }, [
    mapReady,
    showStations,
    showIncidents,
    stations,
    incidentsWithProximity,
    incidentYear,
    resetCarRoutes,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.kakao?.maps;
    if (!mapReady || !map || !maps || carRoutes.length === 0) return;

    const polylines = carRoutes.map((route) => new maps.Polyline({
      path: route.path.map((point) => new maps.LatLng(point.lat, point.lng)),
      strokeWeight: route.priority === "RECOMMEND" ? 6 : 4,
      strokeColor: route.priority === "RECOMMEND" ? "#258766" : "#c27a34",
      strokeOpacity: route.priority === "RECOMMEND" ? 0.9 : 0.78,
      strokeStyle: "solid",
      map,
    }));
    return () => polylines.forEach((polyline) => polyline.setMap(null));
  }, [mapReady, carRoutes]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.kakao?.maps;
    if (!mapReady || !map || !maps || carRoutes.length === 0) return;

    const bounds = new maps.LatLngBounds();
    carRoutes.forEach((route) => {
      route.path.forEach((point) => bounds.extend(new maps.LatLng(point.lat, point.lng)));
    });
    incidentsNearRoute.forEach((incident) => {
      bounds.extend(new maps.LatLng(incident.lat, incident.lng));
    });
    map.setBounds(bounds, 48);
  }, [mapReady, carRoutes, incidentsNearRoute]);

  const searchPlaces = useCallback(async (event: FormEvent<HTMLFormElement>, endpoint: Endpoint) => {
    event.preventDefault();
    const keyword = query.trim();
    if (!keyword) {
      setSearchMessage("장소 이름을 입력해 주세요.");
      return;
    }

    setActiveSearch(endpoint);
    setSearching(true);
    setSearchMessage("");
    setSearchResults([]);
    try {
      const params = new URLSearchParams({
        query: keyword,
        lat: String(origin.lat),
        lng: String(origin.lng),
        radius: "20000",
      });
      const response = await fetch(`/api/kakao/places?${params}`);
      const payload: unknown = await response.json();
      if (!response.ok) {
        setSearchMessage(getProviderErrorMessage("카카오 장소 검색", getApiErrorCode(payload)));
        return;
      }
      if (typeof payload !== "object" || payload === null) {
        setSearchMessage("카카오 장소 검색 응답 형식이 올바르지 않아요.");
        return;
      }

      const values = (payload as Record<string, unknown>).places;
      if (!Array.isArray(values) || !values.every(isPlaceSearchResult)) {
        setSearchMessage("카카오 장소 검색 응답을 읽을 수 없어요.");
        return;
      }
      if (values.length === 0) {
        setSearchMessage("검색 결과가 없어요. 다른 장소 이름으로 검색해 주세요.");
        return;
      }
      setSearchResults(values);
    } catch (error) {
      setSearchMessage(error instanceof Error
        ? error.message
        : getProviderErrorMessage("카카오 장소 검색", null));
    } finally {
      setSearching(false);
    }
  }, [query, origin.lat, origin.lng]);

  const requestCarRoutes = async () => {
    if (!selectedBikeStation) return;

    routeRequestRef.current?.abort();
    const controller = new AbortController();
    routeRequestRef.current = controller;
    setCarRoutes([]);
    setRouteRetrievedAt(null);
    setRouteLoadState("loading");
    setRouteMessage("");

    const priorities: KakaoCarRoute["priority"][] = ["RECOMMEND", "DISTANCE"];
    try {
      const routes = await Promise.all(priorities.map(async (priority) => {
        const params = new URLSearchParams({
          originLat: String(selectedBikeStation.lat),
          originLng: String(selectedBikeStation.lng),
          destinationLat: String(destination.lat),
          destinationLng: String(destination.lng),
          priority,
        });
        const response = await fetch(`/api/kakao/directions?${params}`, {
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const code = getApiErrorCode(payload);
          throw new Error(code === "ROUTE_NOT_FOUND"
            ? "선택한 대여소와 목적지 사이의 자동차 경로를 찾지 못했어요."
            : getProviderErrorMessage("Kakao Mobility Directions", code));
        }
        if (typeof payload !== "object" || payload === null) {
          throw new Error("자동차 경로 응답 형식이 올바르지 않아요.");
        }

        const route = (payload as Record<string, unknown>).route;
        if (!isKakaoCarRoute(route)) {
          throw new Error("자동차 경로 응답 형식이 올바르지 않아요.");
        }
        return route;
      }));

      if (controller.signal.aborted) return;
      setCarRoutes(routes);
      setRouteRetrievedAt(new Date().toISOString());
      setRouteLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setCarRoutes([]);
      setRouteRetrievedAt(null);
      setRouteLoadState("error");
      setRouteMessage(error instanceof Error ? error.message : "자동차 경로를 불러오지 못했어요.");
    } finally {
      if (routeRequestRef.current === controller) routeRequestRef.current = null;
    }
  };

  const updateDeparture = (place: Place) => {
    if (place.lat !== origin.lat || place.lng !== origin.lng) {
      setStations([]);
      setStationRetrievedAt(null);
      setStationErrorMessage("");
      setStationDataState("loading");
      setSelectedStation(null);
      resetCarRoutes();
    }
    setOrigin(place);
  };

  const selectPlace = (result: PlaceSearchResult) => {
    const place = {
      name: result.name,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
    };
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng) || !activeSearch) return;

    if (activeSearch === "origin") updateDeparture(place);
    else {
      setDestination(place);
      resetCarRoutes();
    }
    setSearchResults([]);
    setSearchMessage("");
    setQuery("");
    setActiveSearch(null);
    mapRef.current?.setCenter(new (window.kakao as NonNullable<typeof window.kakao>).maps.LatLng(place.lat, place.lng));
    mapRef.current?.setLevel(5);
  };

  const swapEndpoints = () => {
    const nextOrigin = destination;
    updateDeparture(nextOrigin);
    setDestination(origin);
    const map = mapRef.current;
    const maps = window.kakao?.maps;
    if (map && maps) {
      map.setCenter(new maps.LatLng(nextOrigin.lat, nextOrigin.lng));
      map.setLevel(5);
    }
  };

  const changeZoom = (step: number) => {
    const map = mapRef.current;
    if (map) map.setLevel(Math.max(1, Math.min(12, map.getLevel() + step)));
  };
  const stationSourceLabel = stationDataState === "api"
    ? `서울시 API · ${stations.length}곳`
    : stationDataState === "loading" ? "불러오는 중" : stationDataState === "error" ? "조회 실패" : "주변 대여소 없음";
  const incidentSourceLabel = incidentDataState === "api"
    ? `사고정보 · ${incidentYear}년`
    : incidentDataState === "loading" ? "사고정보 조회 중" : incidentDataState === "error" ? "조회 실패" : "자료 없음";

  return (
    <main className="map-app">
      <header className="app-header">
        <Link className="app-brand" href="/" aria-label="Safe Bike Seoul 홈">
          <span className="app-brand-mark" aria-hidden="true">↗</span>
          <span>safe bike <strong>seoul</strong></span>
        </Link>
        <div className="header-center"><span className="header-location-dot" /> 서울특별시 <span className="header-chevron">⌄</span></div>
        <div className="header-right">
          <span className={`connection-status ${mapReady ? "connected" : mapError ? "error" : ""}`}>
            <i /> {mapReady ? "카카오 지도 연결됨" : mapError ? "지도 설정 확인" : "지도 연결 대기"}
          </span>
          <span className="sample-pill">{incidentSourceLabel}</span>
          <div className="profile-avatar" aria-label="사용자">S</div>
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="sidebar-eyebrow">YOUR SEOUL RIDE</span>
              <h1>어디로 달려볼까요?</h1>
              <p>따릉이·경로·과거 사고정보를 함께 확인하세요.</p>
            </div>
            <span className="compass-mark" aria-hidden="true">✳</span>
          </div>

          <section className="weather-card" aria-label="출발지 현재 날씨">
            <div className="weather-heading">
              <span className="weather-icon" aria-hidden="true">
                {weather ? getWeatherIcon(weather.weatherCode) : "◌"}
              </span>
              <span className="weather-title">
                <strong>{origin.name}</strong>
                <small>{weatherDataState === "api" ? weather?.condition : "출발지 현재 날씨"}</small>
              </span>
              {weather && <strong className="weather-temperature">{weather.temperatureC.toFixed(1)}°C</strong>}
            </div>
            {weatherDataState === "api" && weather ? (
              <>
                <div className="weather-details">
                  <span>체감 {weather.apparentTemperatureC.toFixed(1)}°C</span>
                  <span>강수 {weather.precipitationMm.toFixed(1)}mm</span>
                  <span>풍속 {weather.windSpeedKmh.toFixed(1)}km/h</span>
                </div>
                <p className="weather-meta">
                  출처{" "}
                  <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
                  {" · 관측 "}{weather.observedAt.replace("T", " ")} KST
                </p>
              </>
            ) : (
              <p className={`weather-status ${weatherDataState === "error" ? "error" : ""}`}>
                {weatherDataState === "loading"
                  ? "날씨를 조회하고 있어요."
                  : weatherDataState === "error"
                    ? weatherErrorMessage
                    : "현재 날씨 자료가 없습니다."}
                {weatherDataState !== "api" && <span> · 출처 Open-Meteo</span>}
                {weatherDataState === "error" && (
                  <button
                    className="weather-retry"
                    type="button"
                    onClick={() => setWeatherRefreshKey((key) => key + 1)}
                  >
                    다시 조회
                  </button>
                )}
              </p>
            )}
          </section>

          <section className="route-search-card" aria-label="출발지와 목적지 검색">
            <div className="route-search-title"><strong>경로 찾기</strong><span>자동차 경로</span></div>
            <div className="route-endpoints">
              <span className="route-line" aria-hidden="true" />
              <form className="endpoint-form" onSubmit={(event) => searchPlaces(event, "origin")}>
                <span className="endpoint-dot origin-dot" aria-hidden="true" />
                <label className="sr-only" htmlFor="origin-search">출발지 검색</label>
                <input id="origin-search" value={activeSearch === "origin" ? query : origin.name}
                  onFocus={() => { setActiveSearch("origin"); setQuery(""); }}
                  onChange={(event) => { setActiveSearch("origin"); setQuery(event.target.value); }}
                  placeholder="출발지를 검색하세요" />
                <button type="submit" aria-label="출발지 검색">⌕</button>
              </form>
              <button className="swap-button" type="button" onClick={swapEndpoints} aria-label="출발지와 목적지 바꾸기">↕</button>
              <form className="endpoint-form" onSubmit={(event) => searchPlaces(event, "destination")}>
                <span className="endpoint-dot destination-dot" aria-hidden="true" />
                <label className="sr-only" htmlFor="destination-search">목적지 검색</label>
                <input id="destination-search" value={activeSearch === "destination" ? query : destination.name}
                  onFocus={() => { setActiveSearch("destination"); setQuery(""); }}
                  onChange={(event) => { setActiveSearch("destination"); setQuery(event.target.value); }}
                  placeholder="목적지를 검색하세요" />
                <button type="submit" aria-label="목적지 검색">⌕</button>
              </form>
            </div>

            {searching && <p className="search-message">장소를 찾고 있어요…</p>}
            {searchMessage && <p className="search-message error">{searchMessage}</p>}
            {searchResults.length > 0 && (
              <div className="search-results" role="listbox" aria-label="장소 검색 결과">
                {searchResults.map((result) => (
                  <button type="button" key={result.id} role="option" aria-selected="false" onClick={() => selectPlace(result)}>
                    <span className="result-pin">⌖</span>
                    <span><strong>{result.name}</strong><small>{result.address || result.category}</small></span>
                    <span className="result-arrow">↗</span>
                  </button>
                ))}
              </div>
            )}

            <button className="find-route-button" type="button" disabled={!selectedBikeStation || routeLoadState === "loading"}
              onClick={requestCarRoutes}>
              <span>✦</span>
              {routeLoadState === "loading"
                ? "추천·최단거리 경로 조회 중"
                : selectedBikeStation ? "선택한 대여소에서 자동차 경로 찾기" : "대여소를 선택해 주세요"}
              <span className="button-arrow">→</span>
            </button>
            <p className="route-disclaimer">
              Kakao Mobility 자동차 경로이며 자전거 주행로로 검증되지 않았습니다. 각 경로의 500m 안에 든 사고다발지역 좌표 수를 비교하며, 같은 지역이 경로별로 중복될 수 있습니다. 안전성 평가는 아닙니다.
            </p>
            {routeMessage && <p className="search-message error" role="alert">{routeMessage}</p>}
            {routeLoadState === "ready" && (
              <div className="route-results" aria-label="자동차 경로 결과">
                <strong className="route-results-title">경로별 비교 · 500m 이내 과거 사고다발지역</strong>
                {routeComparisons.map(({ route, nearbyIncidentCount }) => (
                  <div className="route-result-row" key={route.priority}>
                    <div className="route-result-main">
                      <i className={`route-swatch ${route.priority.toLowerCase()}`} />
                      <strong>{route.priority === "RECOMMEND" ? "자동차 추천" : "자동차 최단거리"}</strong>
                      <span>{formatDistance(route.distanceMeters)} · {Math.ceil(route.durationSeconds / 60)}분</span>
                    </div>
                    <small className="route-incident-count">
                      {incidentDataState === "api"
                        ? `500m 이내 과거 사고다발지역 ${nearbyIncidentCount}곳`
                        : incidentDataState === "loading" ? "사고정보 조회 중" : "사고정보 비교 불가"}
                    </small>
                  </div>
                ))}
              </div>
            )}
            <p className="route-data-meta">
              출처 Kakao Mobility Directions · 앱 조회 {formatDataTime(routeRetrievedAt, routeLoadState)}
            </p>
          </section>

          <section className="layers-section" aria-label="지도 표시 설정">
            <div className="section-title-row"><h2>지도에 표시</h2><span>레이어</span></div>
            <button className="layer-row" type="button" aria-pressed={showStations} onClick={() => setShowStations(!showStations)}>
              <span className="layer-symbol station-symbol">🚲</span>
              <span className="layer-copy"><strong>따릉이 대여소</strong><small>실제 위치 · 이용 가능 대수</small></span>
              <span className={`toggle ${showStations ? "on" : ""}`}><i /></span>
            </button>
            <button className="layer-row" type="button" aria-pressed={showIncidents} onClick={() => setShowIncidents(!showIncidents)}>
              <span className="layer-symbol accident-symbol">!</span>
              <span className="layer-copy"><strong>사고다발 지역</strong><small>한국도로교통공단 · 과거 통계</small></span>
              <span className={`toggle ${showIncidents ? "on" : ""}`}><i /></span>
            </button>
          </section>

          <section className="station-section">
            <div className="section-title-row">
              <h2>주변 따릉이 대여소</h2>
              <span className="count-chip">{stationSourceLabel}</span>
            </div>
            <div className="station-list">
              {stations.length === 0 && (
                <p className="station-empty">
                  {stationDataState === "loading"
                    ? `${origin.name} 주변 대여소를 조회하고 있어요.`
                    : stationDataState === "error"
                      ? stationErrorMessage
                      : "출발지 반경 5km 안에 대여소가 없습니다."}
                </p>
              )}
              {stations.slice(0, 8).map((station) => (
                <button className={`station-row ${selectedStation === station.id ? "selected" : ""}`} type="button" key={station.id}
                  onClick={() => {
                    setSelectedStation(station.id);
                    resetCarRoutes();
                    mapRef.current?.setCenter(new (window.kakao as NonNullable<typeof window.kakao>).maps.LatLng(station.lat, station.lng));
                    mapRef.current?.setLevel(4);
                  }}>
                  <span className="station-distance">{formatDistance(station.distanceMeters)}</span>
                  <span className="station-copy">
                    <strong>{station.name}</strong>
                    {station.address !== station.name && <small>{station.address}</small>}
                  </span>
                  <span className="bike-count"><strong>{station.bikes}</strong><small>대</small></span>
                </button>
              ))}
            </div>
            <p className="data-caption">
              출처 서울 열린데이터광장 bikeList · 출발지 반경 5km 거리순 · 앱 조회{" "}
              {formatDataTime(stationRetrievedAt, stationDataState)}
            </p>
          </section>

          <section className="incident-section">
            <div className="section-title-row">
              <h2>경로 주변 사고다발지역</h2>
              <span className="count-chip">
                {incidentDataState === "api" ? `${incidents.length}곳 · ${incidentYear}년` : incidentSourceLabel}
              </span>
            </div>
            <div className="incident-list">
              {incidentDataState === "loading" && (
                <p className="incident-empty">한국도로교통공단의 최신 사고 기준연도를 확인하고 있어요.</p>
              )}
              {incidentDataState === "error" && (
                <p className="incident-empty">{incidentErrorMessage}</p>
              )}
              {incidentDataState === "empty" && (
                <p className="incident-empty">제공되는 사고다발지역 자료가 없습니다.</p>
              )}
              {incidentDataState === "api" && carRoutes.length === 0 && (
                <p className="incident-empty">자동차 경로를 조회하면 경로에서 500m 이내의 사고다발지역을 거리순으로 표시해요. 지도에는 서울시 {incidents.length}곳을 표시하고 있어요.</p>
              )}
              {incidentDataState === "api" && carRoutes.length > 0 && incidentsNearRoute.length === 0 && (
                <p className="incident-empty">자동차 경로 반경 500m 안에 사고다발지역이 없습니다.</p>
              )}
              {incidentsNearRoute.slice(0, 8).map((incident) => (
                <div className="incident-row" key={incident.id}>
                  <span className={`incident-mark ${incident.distanceToRouteMeters !== null ? "near-route" : ""}`}>!</span>
                  <span className="incident-copy">
                    <strong>{incident.title}</strong>
                    <small>
                      {incident.address} · {incident.nearestRoutePriority === "RECOMMEND" ? "추천" : "최단거리"} 경로에서{" "}
                      {incident.distanceToRouteMeters === null ? "거리 미정" : `${Math.round(incident.distanceToRouteMeters)}m`}
                    </small>
                  </span>
                  <span className="incident-level">{incident.level}</span>
                </div>
              ))}
            </div>
            <p className="data-caption">
              출처 한국도로교통공단 자전거 사고다발지역 API · {incidentYear ? `${incidentYear}년 통계` : "과거 통계"}
              {" · 앱 조회 "}{formatDataTime(incidentRetrievedAt, incidentDataState)}
              {incidentDataState === "api" ? " · 두 경로 중 가까운 경로에서 500m 이내 지점을 표시합니다." : ""}
            </p>
          </section>

          <div className="sample-notice">
            <span>ⓘ</span>
            <p>
              <strong>기준 시각과 해석</strong><br />
              시각은 앱의 API 응답 수신 시각(KST)이며 원본 측정·갱신 시각과 다를 수 있습니다. 사고정보는 {incidentYear ? `${incidentYear}년 ` : ""}과거 통계로 실시간 현황이 아니며, 경로·사고다발지역 수로 실제 안전성을 단정할 수 없습니다.
            </p>
          </div>
        </aside>

        <section className="map-panel" aria-label="서울 자전거 지도">
          <div className="map-toolbar">
            <div className="map-title"><span className="map-title-mark">⌖</span><div><h2>서울 자전거 지도</h2><p>출발지와 목적지를 검색해 보세요</p></div></div>
            <div className="map-toolbar-right"><span className="demo-map-label"><i /> {mapReady ? "라이딩 지도" : mapError ? "예시 지도" : "지도 준비 중"}</span><button type="button" className="map-menu-button" aria-label="지도 옵션">•••</button></div>
          </div>
          <div className="map-stage">
            {!mapReady && (
              <div className="map-demo-fallback" aria-hidden="true">
                <svg viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">
                  <rect width="1000" height="700" fill="#edf1e8" />
                  <path d="M-50 72 140 30l137 62 123-49 140 42 150-39 350 70v143l-205 38-126-46-160 54-126-50-148 45-120-37-107 42Z" fill="#e2eadb" />
                  <path d="M-30 568 122 517l123 38 135-84 112 43 139-48 141 61 238-48v230H-30Z" fill="#e2eadb" />
                  <g className="fallback-roads">
                    <path d="m-20 174 256 84 235-93 197 84 355-89" />
                    <path d="m18 429 181-113 185 76 189-70 274 138" />
                    <path d="m138-30 69 218-26 171 105 165-36 213" />
                    <path d="m395-20 40 216-53 182 83 145-29 194" />
                    <path d="m696-20-72 210 45 169-75 158 54 214" />
                    <path d="m891-10-72 224 31 182-66 169 39 149" />
                    <path d="m-18 280 253 23 202-54 251 36 323-27" />
                    <path d="m-17 502 225-38 222 44 204-39 369 42" />
                  </g>
                  <path className="fallback-river" d="M-40 354c123-63 203 54 334 1s184-46 276-2 154 62 254 3 133-54 216-16v112c-96-48-134-12-238 35s-168 19-277-19-145-39-236 7-190 72-329 6Z" />
                  <text x="472" y="426" className="fallback-river-label">한 강</text>
                  <text x="214" y="256" className="fallback-place-label">마포</text>
                  <text x="733" y="497" className="fallback-place-label">잠실</text>
                </svg>
                {showStations && stations.map((station) => {
                  const position = getDemoMapPosition(station.lat, station.lng);
                  return (
                  <span className="fallback-pin fallback-bike" key={station.id}
                    style={{ left: position.left, top: position.top }}>{station.bikes}</span>
                  );
                })}
                {showIncidents && incidentsWithProximity.map((incident) => {
                  const position = getDemoMapPosition(incident.lat, incident.lng);
                  const nearRoute = incident.distanceToRouteMeters !== null &&
                    incident.distanceToRouteMeters <= ROUTE_INCIDENT_RADIUS_METERS;
                  return (
                  <span className={`fallback-pin fallback-alert ${nearRoute ? "near-route" : ""}`} key={incident.id}
                    style={{ left: position.left, top: position.top }}>!</span>
                  );
                })}
              </div>
            )}
            <div className="map-canvas" ref={mapElement} aria-label="카카오맵 지도 영역" />
            {!mapReady && (
              <div className="map-state-card">
                <span className="map-state-icon">{mapError ? "!" : "⌖"}</span>
                <strong>{mapError ? "지도를 표시할 수 없어요" : "카카오 지도를 불러오는 중"}</strong>
                <p>{mapError || "잠시만 기다려 주세요."}</p>
              </div>
            )}
            <div className="map-zoom-controls" aria-label="지도 확대 축소">
              <button type="button" onClick={() => changeZoom(-1)} aria-label="확대">+</button>
              <span />
              <button type="button" onClick={() => changeZoom(1)} aria-label="축소">−</button>
            </div>
            <div className="map-legend">
              {mapReady && carRoutes.map((route) => (
                <span key={route.priority}>
                  <i className={`legend-route ${route.priority.toLowerCase()}`} />
                  {route.priority === "RECOMMEND" ? "자동차 추천" : "자동차 최단거리"}
                </span>
              ))}
              <span><i className="legend-station">🚲</i>따릉이 대여소</span>
              <span><i className="legend-incident">!</i>사고다발지역 {incidentYear ? `(${incidentYear}년)` : ""}</span>
              {incidentsNearRoute.length > 0 && (
                <span><i className="legend-incident near-route">!</i>경로 500m 이내</span>
              )}
            </div>
            <div className="map-attribution-note">
              {mapReady
                ? `대여소: 서울 열린데이터광장 · 경로: Kakao Mobility · 사고다발: 한국도로교통공단 ${incidentYear ?? ""}년 과거 통계`
                : carRoutes.length > 0
                  ? "Kakao 지도 SDK에 연결되지 않아 경로선은 지도에 표시하지 않습니다."
                : "카카오 지도 연결 전 미리보기 · 바탕 지도는 실제 지도가 아닙니다."}
            </div>
          </div>
          <div className="map-footer">
            <div><span className="footer-live-dot" /> 서울 중심 보기</div>
            <span>© Kakao Mobility Corp.</span>
            <button type="button" onClick={() => mapRef.current?.setCenter(new (window.kakao as NonNullable<typeof window.kakao>).maps.LatLng(37.545, 126.97))}>서울 중심으로 이동 <span>↗</span></button>
          </div>
        </section>
      </div>
    </main>
  );
}
