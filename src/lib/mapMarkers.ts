import type { Coordinates, MapMarker, MapRegion, Stop } from '../types';
import { distanceInMeters } from './alerts';

const MAX_CLUSTER_RADIUS_METERS = 250;
const MIN_CLUSTER_RADIUS_METERS = 10;

type BuildMapMarkersOptions = {
  expandedStopIds: string[];
  favoriteStopIds: string[];
  selectedStopId: string;
  warnedStopIds: string[];
};

type StopCluster = {
  latitude: number;
  longitude: number;
  stops: Stop[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clusterRadiusFromRegion(region: MapRegion) {
  const delta = Math.max(region.latitudeDelta, region.longitudeDelta);
  return clamp(delta * 111_000 * 0.009, MIN_CLUSTER_RADIUS_METERS, MAX_CLUSTER_RADIUS_METERS);
}

function averageCoordinates(stops: Stop[]): Coordinates {
  return {
    latitude: stops.reduce((sum, stop) => sum + stop.latitude, 0) / stops.length,
    longitude: stops.reduce((sum, stop) => sum + stop.longitude, 0) / stops.length,
  };
}

function isStopNearCluster(stop: Stop, cluster: StopCluster, clusterRadiusMeters: number) {
  return (
    distanceInMeters(stop, cluster) <= clusterRadiusMeters ||
    cluster.stops.some((member) => distanceInMeters(stop, member) <= clusterRadiusMeters)
  );
}

function buildClusters(
  stops: Stop[],
  clusterRadiusMeters: number,
  forcedSingleStopIds: Set<string>,
) {
  const clusters: StopCluster[] = [];

  stops.forEach((stop) => {
    if (forcedSingleStopIds.has(stop.id)) {
      clusters.push({
        latitude: stop.latitude,
        longitude: stop.longitude,
        stops: [stop],
      });
      return;
    }

    const matchingCluster = clusters.find(
      (cluster) =>
        cluster.stops.length > 0 &&
        !cluster.stops.some((member) => forcedSingleStopIds.has(member.id)) &&
        isStopNearCluster(stop, cluster, clusterRadiusMeters),
    );

    if (!matchingCluster) {
      clusters.push({
        latitude: stop.latitude,
        longitude: stop.longitude,
        stops: [stop],
      });
      return;
    }

    matchingCluster.stops.push(stop);
    const average = averageCoordinates(matchingCluster.stops);
    matchingCluster.latitude = average.latitude;
    matchingCluster.longitude = average.longitude;
  });

  return clusters;
}

function labelFromCount(count: number) {
  return count > 9 ? '9+' : `${count}`;
}

export function buildMapMarkers(
  stops: Stop[],
  region: MapRegion,
  options: BuildMapMarkersOptions,
): MapMarker[] {
  const warnedStopIds = new Set(options.warnedStopIds);
  const favoriteStopIds = new Set(options.favoriteStopIds);
  const forcedSingleStopIds = new Set(
    [options.selectedStopId, ...options.expandedStopIds].filter(Boolean),
  );
  const clusters = buildClusters(
    [...stops].sort((left, right) => left.name.localeCompare(right.name)),
    clusterRadiusFromRegion(region),
    forcedSingleStopIds,
  );

  return clusters
    .map((cluster, index) => {
      if (cluster.stops.length === 1) {
        const stop = cluster.stops[0];

        return {
          type: 'stop' as const,
          favorite: favoriteStopIds.has(stop.id),
          id: `marker-stop-${stop.id}`,
          label: stop.name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          selected: stop.id === options.selectedStopId,
          stopId: stop.id,
          warned: warnedStopIds.has(stop.id),
        };
      }

      return {
        type: 'cluster' as const,
        count: cluster.stops.length,
        id: `marker-cluster-${index}-${cluster.stops.map((stop) => stop.id).join('-')}`,
        label: labelFromCount(cluster.stops.length),
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        stopIds: cluster.stops.map((stop) => stop.id),
        warned: cluster.stops.some((stop) => warnedStopIds.has(stop.id)),
      };
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'cluster' ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });
}
