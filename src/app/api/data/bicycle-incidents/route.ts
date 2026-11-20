import { NextResponse } from "next/server";
import type { BicycleIncident } from "@/lib/api-contracts";
import {
  apiErrorResponse,
  ApiProviderError,
  fetchProviderJson,
  getServerApiKey,
  invalidQueryResponse,
  isRecord,
  missingApiKeyResponse,
} from "@/lib/server/api-provider";

const seoulDistrictCodes = new Set([
  "110", "140", "170", "200", "215", "230", "260", "290", "305", "320",
  "350", "380", "410", "440", "470", "500", "530", "545", "560", "590",
  "620", "650", "680", "710", "740",
]);
const INCIDENT_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const DISTRICT_BATCH_SIZE = 5;

type IncidentYearData = {
  year: number;
  incidents: BicycleIncident[];
};

let latestIncidentCache: { expiresAt: number; data: IncidentYearData } | null = null;
let latestIncidentRequest: Promise<IncidentYearData> | null = null;

function coordinate(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getIncidentRows(payload: unknown): unknown[] {
  const root = isRecord(payload) ? payload : null;
  const response = root && isRecord(root.response) ? root.response : null;
  const body = response && isRecord(response.body)
    ? response.body
    : root && isRecord(root.body) ? root.body : root;
  if (!body) throw new ApiProviderError("UPSTREAM_INVALID_RESPONSE", 502);

  const header = response && isRecord(response.header)
    ? response.header
    : isRecord(body.header) ? body.header : null;
  const resultCode = header?.resultCode;
  if (typeof resultCode === "string" && !["00", "0", "INFO-000"].includes(resultCode)) {
    console.error(`[Data.go.kr] returned provider code ${resultCode}`);
    throw new ApiProviderError("UPSTREAM_REJECTED", 502);
  }

  const items = isRecord(body.items) ? body.items : body;
  const item = items.item;
  if (Array.isArray(item)) return item;
  return item === undefined || item === null ? [] : [item];
}

async function fetchDistrictIncidents(key: string, year: number, guGun: string): Promise<BicycleIncident[]> {
  const endpoint = new URL(
    "https://apis.data.go.kr/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle",
  );
  let decodedKey = key;
  try {
    decodedKey = decodeURIComponent(key);
  } catch {
    decodedKey = key;
  }
  endpoint.searchParams.set("ServiceKey", decodedKey);
  endpoint.searchParams.set("searchYearCd", String(year));
  endpoint.searchParams.set("siDo", "11");
  endpoint.searchParams.set("guGun", guGun);
  endpoint.searchParams.set("type", "json");
  endpoint.searchParams.set("numOfRows", "100");
  endpoint.searchParams.set("pageNo", "1");

  const payload = await fetchProviderJson(endpoint, {}, "Korea Road Traffic Authority");
  return getIncidentRows(payload).flatMap((row) => {
    if (!isRecord(row)) return [];
    const lat = coordinate(row.la_crd ?? row.laCrd);
    const lng = coordinate(row.lo_crd ?? row.loCrd);
    const title = typeof (row.spot_nm ?? row.spotNm) === "string"
      ? String(row.spot_nm ?? row.spotNm)
      : "";
    if (
      lat === null || lat < -90 || lat > 90 ||
      lng === null || lng < -180 || lng > 180 ||
      !title
    ) {
      return [];
    }

    const count = coordinate(row.occrrnc_cnt ?? row.occrrncCnt);
    return [{
      id: String(row.afos_fid ?? row.afosFid ?? row.spot_cd ?? row.spotCd ?? `${lng},${lat}`),
      title,
      address: typeof (row.sido_sgg_nm ?? row.sidoSggNm) === "string"
        ? String(row.sido_sgg_nm ?? row.sidoSggNm)
        : "서울특별시",
      lat,
      lng,
      level: count === null ? "사고 다발" : `사고 ${count}건`,
    }];
  });
}

async function fetchSeoulIncidentsForYear(key: string, year: number): Promise<BicycleIncident[]> {
  const districts = [...seoulDistrictCodes];
  const incidents: BicycleIncident[] = [];
  for (let offset = 0; offset < districts.length; offset += DISTRICT_BATCH_SIZE) {
    const batch = districts.slice(offset, offset + DISTRICT_BATCH_SIZE);
    const results = await Promise.all(batch.map((guGun) => fetchDistrictIncidents(key, year, guGun)));
    incidents.push(...results.flat());
  }

  const uniqueIncidents = new Map(incidents.map((incident) => [incident.id, incident]));
  return [...uniqueIncidents.values()].sort((first, second) =>
    first.address.localeCompare(second.address, "ko") || first.title.localeCompare(second.title, "ko"),
  );
}

async function discoverLatestSeoulIncidents(key: string): Promise<IncidentYearData> {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 10; year--) {
    const incidents = await fetchSeoulIncidentsForYear(key, year);
    if (incidents.length > 0) return { year, incidents };
  }
  throw new ApiProviderError("NO_INCIDENT_DATA", 502);
}

function getLatestSeoulIncidents(key: string): Promise<IncidentYearData> {
  if (latestIncidentCache && latestIncidentCache.expiresAt > Date.now()) {
    return Promise.resolve(latestIncidentCache.data);
  }
  if (!latestIncidentRequest) {
    latestIncidentRequest = discoverLatestSeoulIncidents(key)
      .then((data) => {
        latestIncidentCache = { data, expiresAt: Date.now() + INCIDENT_CACHE_TTL_MS };
        return data;
      })
      .finally(() => {
        latestIncidentRequest = null;
      });
  }
  return latestIncidentRequest;
}

export async function GET(request: Request) {
  const key = getServerApiKey("DATA_GO_KR_API_KEY");
  if (!key) return missingApiKeyResponse();

  const params = new URL(request.url).searchParams;
  const currentYear = new Date().getFullYear();
  const requestedYear = params.has("year") ? Number(params.get("year")) : null;
  const guGun = params.get("guGun");
  if (
    (requestedYear !== null && (!Number.isInteger(requestedYear) || requestedYear < 2000 || requestedYear > currentYear)) ||
    (guGun !== null && !seoulDistrictCodes.has(guGun))
  ) {
    return invalidQueryResponse();
  }

  try {
    const data = guGun !== null
      ? {
          year: requestedYear ?? currentYear - 1,
          incidents: await fetchDistrictIncidents(key, requestedYear ?? currentYear - 1, guGun),
        }
      : requestedYear !== null
        ? { year: requestedYear, incidents: await fetchSeoulIncidentsForYear(key, requestedYear) }
        : await getLatestSeoulIncidents(key);
    return NextResponse.json({
      source: "korea-road-traffic-authority",
      year: data.year,
      incidents: data.incidents,
    });
  } catch (error) {
    return apiErrorResponse(error, "Korea Road Traffic Authority");
  }
}
