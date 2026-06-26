import type { Alert, AlertCategory, Preferences, RankedAlert } from '../types';

export const ACTIVE_WINDOW_MINUTES = 15;
export const CLUSTER_RADIUS_METERS = 280;
export const CLUSTER_WINDOW_MINUTES = 5;
export const NEARBY_WARNING_RADIUS_METERS = 150;
const MAX_EXTENSION_MINUTES = 18;

const CATEGORY_BONUS: Record<AlertCategory, number> = {
  Barrierefrei: 12,
  Baustelle: 16,
  Ausfall: 20,
  Stoerung: 10,
  Ueberfuellung: 8,
  Umleitung: 15,
  Verspaetung: 9,
};

type GeoPoint = {
  latitude: number;
  longitude: number;
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceInMeters(left: GeoPoint, right: GeoPoint) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function ageInMinutes(createdAt: string) {
  return Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));
}

export function mergeAlerts(existing: Alert[], incoming: Alert[]) {
  const byId = new Map(existing.map((alert) => [alert.id, alert]));

  incoming.forEach((alert) => {
    byId.set(alert.id, alert);
  });

  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function formatRelativeTime(minutes: number) {
  if (minutes <= 1) {
    return 'gerade eben';
  }

  if (minutes < 60) {
    return `vor ${minutes} Min`;
  }

  const hours = Math.floor(minutes / 60);

  return `vor ${hours} Std`;
}

function matchesCluster(left: Alert, right: Alert) {
  const minutesApart = Math.abs(
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  const withinTimeWindow = minutesApart <= CLUSTER_WINDOW_MINUTES * 60_000;
  const nearSameSpot =
    left.stopId === right.stopId || distanceInMeters(left, right) <= CLUSTER_RADIUS_METERS;

  return withinTimeWindow && nearSameSpot;
}

export function rankAlerts(alerts: Alert[], preferences: Preferences): RankedAlert[] {
  const withClusterData = alerts.map((alert) => {
    const ageMinutes = ageInMinutes(alert.createdAt);
    const clusterCount = alerts.filter(
      (candidate) => candidate.id !== alert.id && matchesCluster(alert, candidate),
    ).length;
    const favoriteStopMatch = preferences.favoriteStopIds.includes(alert.stopId);
    const favoriteLineMatch = preferences.favoriteLines.includes(alert.line);
    const favoriteBonus = (favoriteStopMatch ? 18 : 0) + (favoriteLineMatch ? 12 : 0);
    const recencyScore = Math.max(0, 80 - ageMinutes * 1.3);
    const clusterBonus = clusterCount * 18;
    const activeWindowMinutes = ACTIVE_WINDOW_MINUTES + Math.min(MAX_EXTENSION_MINUTES, clusterCount * 3);
    const score = Math.round(
      recencyScore + clusterBonus + favoriteBonus + CATEGORY_BONUS[alert.category],
    );

    return {
      ...alert,
      activeWindowMinutes,
      ageMinutes,
      clusterCount,
      favoriteMatch: favoriteStopMatch || favoriteLineMatch,
      score,
    };
  });

  return withClusterData
    .filter((alert) => alert.ageMinutes <= alert.activeWindowMinutes)
    .map((alert) => {
      const clusterCount = withClusterData.filter(
        (candidate) => candidate.id !== alert.id && matchesCluster(alert, candidate),
      ).length;

      return {
        ...alert,
        clusterCount,
      };
    })
    .sort((left, right) => right.score - left.score || left.ageMinutes - right.ageMinutes);
}
