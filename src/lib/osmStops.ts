import { distanceInMeters } from './alerts';
import type { MapRegion, Stop } from '../types';

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const STOP_COMBINE_RADIUS_METERS = 4;

type OverpassElement = {
  center?: {
    lat: number;
    lon: number;
  };
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  type: 'node' | 'relation' | 'way';
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildQuery(region: MapRegion) {
  const radiusMeters = Math.round(
    clamp(Math.max(region.latitudeDelta, region.longitudeDelta) * 111_000 * 0.85, 450, 2200),
  );

  return `
[out:json][timeout:25];
(
  nwr["highway"="bus_stop"](around:${radiusMeters},${region.latitude},${region.longitude});
  nwr["public_transport"="platform"]["bus"!="no"](around:${radiusMeters},${region.latitude},${region.longitude});
  nwr["amenity"="bus_station"](around:${radiusMeters},${region.latitude},${region.longitude});
);
out center tags;
`;
}

function splitRouteRefs(tags: Record<string, string>) {
  const values = Object.entries(tags)
    .filter(([key]) => key === 'route_ref' || key.startsWith('route_ref:'))
    .map(([, value]) => value);

  const lines = values
    .flatMap((value) => value.split(/[;,]/))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(lines)].sort((left, right) => left.localeCompare(right));
}

function coordinatesFromElement(element: OverpassElement) {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { latitude: element.lat, longitude: element.lon };
  }

  if (element.center) {
    return { latitude: element.center.lat, longitude: element.center.lon };
  }

  return null;
}

function stopKey(stop: Stop) {
  return `${stop.name}|${stop.latitude.toFixed(5)}|${stop.longitude.toFixed(5)}`;
}

function isGeneratedStopName(name: string) {
  return /^Haltestelle \d+$/i.test(name);
}

function pickPreferredStop(stops: Stop[]) {
  return [...stops].sort((left, right) => {
    const generatedDelta =
      Number(isGeneratedStopName(left.name)) - Number(isGeneratedStopName(right.name));

    if (generatedDelta !== 0) {
      return generatedDelta;
    }

    const neighborhoodDelta =
      Number(left.neighborhood === 'OpenStreetMap') - Number(right.neighborhood === 'OpenStreetMap');

    if (neighborhoodDelta !== 0) {
      return neighborhoodDelta;
    }

    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  })[0];
}

function combineCloseStops(stops: Stop[]) {
  const clusters: Stop[][] = [];

  stops.forEach((stop) => {
    const matchingCluster = clusters.find((cluster) =>
      cluster.some((member) => distanceInMeters(member, stop) <= STOP_COMBINE_RADIUS_METERS),
    );

    if (matchingCluster) {
      matchingCluster.push(stop);
      return;
    }

    clusters.push([stop]);
  });

  return clusters.map((cluster) => {
    const preferred = pickPreferredStop(cluster);
    const lines = [...new Set(cluster.flatMap((stop) => stop.lines))].sort((left, right) =>
      left.localeCompare(right),
    );
    const latitude =
      cluster.reduce((sum, stop) => sum + stop.latitude, 0) / cluster.length;
    const longitude =
      cluster.reduce((sum, stop) => sum + stop.longitude, 0) / cluster.length;

    return {
      id: cluster.map((stop) => stop.id).sort((left, right) => left.localeCompare(right)).join('+'),
      latitude,
      lines,
      longitude,
      name: preferred.name,
      neighborhood: preferred.neighborhood,
    };
  });
}

function addDuplicateNameSuffixes(stops: Stop[]) {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();

  stops.forEach((stop) => {
    totals.set(stop.name, (totals.get(stop.name) ?? 0) + 1);
  });

  return stops.map((stop) => {
    const total = totals.get(stop.name) ?? 1;

    if (total === 1) {
      return stop;
    }

    const occurrence = (seen.get(stop.name) ?? 0) + 1;
    seen.set(stop.name, occurrence);

    return {
      ...stop,
      name: occurrence === 1 ? stop.name : `${stop.name} ${occurrence}`,
    };
  });
}

function toStop(element: OverpassElement): Stop | null {
  const coords = coordinatesFromElement(element);
  if (!coords) {
    return null;
  }

  const tags = element.tags ?? {};
  const name = tags.name?.trim() || tags.ref?.trim() || `Haltestelle ${element.id}`;
  const localRef = tags.local_ref?.trim();
  const neighborhood =
    tags.network?.trim() ||
    tags.operator?.trim() ||
    (localRef ? `Steig ${localRef}` : 'OpenStreetMap');

  return {
    id: `${element.type}-${element.id}`,
    latitude: coords.latitude,
    lines: splitRouteRefs(tags),
    longitude: coords.longitude,
    name,
    neighborhood,
  };
}

export async function fetchNearbyBusStops(region: MapRegion, signal?: AbortSignal) {
  const query = buildQuery(region);
  const response = await fetch(OVERPASS_API_URL, {
    body: `data=${encodeURIComponent(query)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    method: 'POST',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed with status ${response.status}`);
  }

  const data = (await response.json()) as OverpassResponse;
  const stops = (data.elements ?? [])
    .map(toStop)
    .filter((stop): stop is Stop => !!stop);

  const deduped = new Map<string, Stop>();
  stops.forEach((stop) => {
    const key = stopKey(stop);
    const previous = deduped.get(key);

    if (!previous) {
      deduped.set(key, stop);
      return;
    }

    deduped.set(key, {
      ...previous,
      lines: [...new Set([...previous.lines, ...stop.lines])].sort((left, right) =>
        left.localeCompare(right),
      ),
    });
  });

  const clusteredStops = combineCloseStops([...deduped.values()]);

  return addDuplicateNameSuffixes(
    clusteredStops
    .sort(
      (left, right) =>
        distanceInMeters(left, region) - distanceInMeters(right, region) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 120),
  );
}
