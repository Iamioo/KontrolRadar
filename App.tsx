import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { startTransition, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import TransitMap from './src/components/TransitMap';
import { DEFAULT_REGION } from './src/data/mock';
import { getLocalPeerId, publishPeerAlert, subscribeToPeerAlerts } from './src/lib/alertMesh';
import {
  ACTIVE_WINDOW_MINUTES,
  CLUSTER_RADIUS_METERS,
  distanceInMeters,
  formatDistance,
  formatRelativeTime,
  mergeAlerts,
  NEARBY_WARNING_RADIUS_METERS,
  rankAlerts,
} from './src/lib/alerts';
import { buildMapMarkers } from './src/lib/mapMarkers';
import { fetchNearbyBusStops } from './src/lib/osmStops';
import type {
  Alert,
  AlertCategory,
  Coordinates,
  OccupancyLevel,
  MapRegion,
  Preferences,
  ReportDraft,
  Stop,
} from './src/types';

type AppTab = 'map' | 'alerts' | 'favorites';
type ExpandedClusterState = {
  collapseLatitudeDelta: number;
  collapseLongitudeDelta: number;
  stopIds: string[];
};

const STORAGE_KEYS = {
  alerts: 'kontrolradar/alerts',
  preferences: 'kontrolradar/preferences',
};

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  Barrierefrei: 'Barrierefrei',
  Baustelle: 'Baustelle',
  Ausfall: 'Ausfall',
  Stoerung: 'Stoerung',
  Ueberfuellung: 'Ueberfuellung',
  Umleitung: 'Umleitung',
  Verspaetung: 'Verspaetung',
};

const TAB_OPTIONS: Array<{ id: AppTab; label: string }> = [
  { id: 'map', label: 'Karte' },
  { id: 'alerts', label: 'Warnungen' },
  { id: 'favorites', label: 'Favoriten' },
];

const EMPTY_PREFERENCES: Preferences = {
  favoriteLines: [],
  favoriteStopIds: [],
  notificationsEnabled: true,
  onboardingCompleted: false,
};

const EMPTY_DRAFT: ReportDraft = {
  direction: '',
  extraInfo: '',
  liveDurationMinutes: 3,
  line: '',
  nextStopId: '',
  nextStopName: '',
  occupancy: '3-Mittel',
  shareLiveLocation: false,
  vehicleNumber: '',
};

const OCCUPANCY_OPTIONS: OccupancyLevel[] = [
  '1-Leer',
  '2-Eher leer',
  '3-Mittel',
  '4-Voll',
  '5-Sehr voll',
];

const LIVE_DURATION_OPTIONS = [1, 3, 5, 10, 15];

const PALETTE = {
  accent: '#0F4C5C',
  accentSoft: '#DDEDF1',
  alert: '#A64B42',
  background: '#F2F0EA',
  border: '#D5D0C4',
  card: '#FCFBF7',
  ink: '#14212B',
  muted: '#6A7175',
  success: '#627F2C',
  successSoft: '#E5ECD3',
};

function buildRegion(latitude: number, longitude: number): MapRegion {
  return {
    latitude,
    latitudeDelta: 0.015,
    longitude,
    longitudeDelta: 0.015,
  };
}

function toggleArrayValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function normalizeLineValue(value: string) {
  return value.trim().toUpperCase();
}

function parseStoredValue<T>(rawValue: string | null, fallback: T): T {
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function formatAlertHeadline(alert: Alert) {
  const line = alert.line.trim();

  if (!line) {
    return 'Warnung';
  }

  return `${CATEGORY_LABELS[alert.category]} | Linie ${line}`;
}

function formatAlertDetails(
  alert: Pick<Alert, 'nextStopName' | 'occupancy' | 'vehicleNumber'>,
  ageLabel?: string,
) {
  const parts = [
    alert.nextStopName?.trim() ? `Naechste Haltestelle ${alert.nextStopName.trim()}` : null,
    alert.occupancy ? `Auslastung ${alert.occupancy}` : null,
    alert.vehicleNumber?.trim() ? `Fahrzeug ${alert.vehicleNumber.trim()}` : null,
    ageLabel ?? null,
  ].filter((value): value is string => !!value);

  return parts.join(' | ');
}

function isLiveLocationActive(alert: Alert) {
  if (!alert.liveLocation?.expiresAt) {
    return false;
  }

  return new Date(alert.liveLocation.expiresAt).getTime() > Date.now();
}

export default function App() {
  const { width } = useWindowDimensions();
  const localPeerId = useMemo(() => getLocalPeerId(), []);
  const [activeTab, setActiveTab] = useState<AppTab>('map');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [expandedClusterState, setExpandedClusterState] = useState<ExpandedClusterState | null>(
    null,
  );
  const [favoriteLineInput, setFavoriteLineInput] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [isChoosingNextStop, setChoosingNextStop] = useState(false);
  const [isReportModalOpen, setReportModalOpen] = useState(false);
  const [locationState, setLocationState] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [mapRegion, setMapRegion] = useState<MapRegion>(DEFAULT_REGION);
  const [preferences, setPreferences] = useState<Preferences>(EMPTY_PREFERENCES);
  const [reportOriginStopId, setReportOriginStopId] = useState('');
  const [selectedLiveAlertId, setSelectedLiveAlertId] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string>('');
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [stopsState, setStopsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const isDesktop = Platform.OS === 'web' && width >= 1080;
  const isWide = width >= 760;

  useEffect(() => {
    let isMounted = true;

    async function hydrateApp() {
      try {
        const [storedPreferences, storedAlerts] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.preferences),
          AsyncStorage.getItem(STORAGE_KEYS.alerts),
        ]);

        if (!isMounted) {
          return;
        }

        setPreferences(parseStoredValue(storedPreferences, EMPTY_PREFERENCES));
        setAlerts(
          mergeAlerts(
            [],
            parseStoredValue<Alert[]>(storedAlerts, []).filter(
              (alert) => !alert.id.startsWith('seed-'),
            ),
          ),
        );
      } finally {
        if (isMounted) {
          setHydrated(true);
        }
      }
    }

    hydrateApp();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();
    const timeoutId = setTimeout(async () => {
      setStopsState('loading');

      try {
        const nextStops = await fetchNearbyBusStops(mapRegion, abortController.signal);

        if (!isMounted) {
          return;
        }

        setStops(nextStops);
        setStopsError(null);
        setStopsState('ready');
        setSelectedStopId((current) =>
          nextStops.some((stop) => stop.id === current) ? current : nextStops[0]?.id ?? '',
        );
      } catch (error) {
        if (!isMounted || abortController.signal.aborted) {
          return;
        }

        setStopsState('error');
        setStopsError('Haltestellen konnten gerade nicht von OpenStreetMap geladen werden.');

        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
      }
    }, 350);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [
    mapRegion.latitude,
    mapRegion.latitudeDelta,
    mapRegion.longitude,
    mapRegion.longitudeDelta,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function requestLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (!isMounted) {
          return;
        }

        if (status !== 'granted') {
          setLocationState('denied');
          return;
        }

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!isMounted) {
          return;
        }

        const coords = {
          latitude: currentPosition.coords.latitude,
          longitude: currentPosition.coords.longitude,
        };

        setUserLocation(coords);
        setLocationState('granted');
        setMapRegion(buildRegion(coords.latitude, coords.longitude));
      } catch {
        if (isMounted) {
          setLocationState('denied');
        }
      }
    }

    requestLocation();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    AsyncStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(preferences)).catch(() => undefined);
  }, [hydrated, preferences]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    AsyncStorage.setItem(STORAGE_KEYS.alerts, JSON.stringify(alerts)).catch(() => undefined);
  }, [alerts, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    return subscribeToPeerAlerts((alert) => {
      setAlerts((current) => mergeAlerts(current, [alert]));
    });
  }, [hydrated]);

  useEffect(() => {
    if (!expandedClusterState) {
      return;
    }

    const shouldCollapse =
      mapRegion.latitudeDelta > expandedClusterState.collapseLatitudeDelta ||
      mapRegion.longitudeDelta > expandedClusterState.collapseLongitudeDelta ||
      expandedClusterState.stopIds.every((stopId) => !stops.some((stop) => stop.id === stopId));

    if (shouldCollapse) {
      setExpandedClusterState(null);
    }
  }, [
    expandedClusterState,
    mapRegion.latitudeDelta,
    mapRegion.longitudeDelta,
    stops,
  ]);

  const lineOptions = useMemo(
    () =>
      [...new Set(stops.flatMap((stop) => stop.lines.map(normalizeLineValue)).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [stops],
  );
  const selectedStop =
    (selectedStopId ? stops.find((stop) => stop.id === selectedStopId) : null) ??
    (selectedStopId ? stops[0] : null) ?? {
      id: '',
      latitude: mapRegion.latitude,
      lines: [],
      longitude: mapRegion.longitude,
      name:
        stopsState === 'loading'
          ? 'Haltestellen werden geladen'
          : stopsState === 'error'
            ? 'Keine Haltestelle verfuegbar'
            : 'Haltestelle waehlen',
      neighborhood:
        stopsState === 'loading'
          ? 'OpenStreetMap wird abgefragt.'
          : stopsState === 'error'
            ? (stopsError ?? 'Haltestellen konnten nicht geladen werden.')
            : 'Im aktuellen Kartenausschnitt wurden keine Bushaltestellen gefunden.',
    };
  const hasSelectedStop = selectedStop.id.length > 0;
  const referencePoint = userLocation ?? {
    latitude: DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  };
  const nearbyStops = [...stops]
    .sort(
      (left, right) =>
        distanceInMeters(left, referencePoint) - distanceInMeters(right, referencePoint),
    )
    .slice(0, 5);
  const rankedAlerts = rankAlerts(alerts, preferences);
  const warnedStopIds = useMemo(
    () => [...new Set(rankedAlerts.map((alert) => alert.stopId))],
    [rankedAlerts],
  );
  const stopMarkers = useMemo(
    () =>
      buildMapMarkers(stops, mapRegion, {
        expandedStopIds: expandedClusterState?.stopIds ?? [],
        favoriteStopIds: preferences.favoriteStopIds,
        selectedStopId,
        warnedStopIds,
      }),
    [
      expandedClusterState?.stopIds,
      mapRegion,
      preferences.favoriteStopIds,
      selectedStopId,
      stops,
      warnedStopIds,
    ],
  );
  const liveAlertMarkers = useMemo(
    () =>
      rankedAlerts
        .filter((alert) => isLiveLocationActive(alert) && alert.liveLocation)
        .map((alert) => ({
          type: 'live' as const,
          alertId: alert.id,
          id: `live-${alert.id}`,
          label: alert.line || 'Live',
          latitude: alert.liveLocation?.latitude ?? alert.latitude,
          line: alert.line,
          longitude: alert.liveLocation?.longitude ?? alert.longitude,
          warned: true,
        })),
    [rankedAlerts],
  );
  const mapMarkers = useMemo(
    () => [...stopMarkers, ...liveAlertMarkers],
    [liveAlertMarkers, stopMarkers],
  );
  const selectedStopAlerts = hasSelectedStop
    ? rankedAlerts.filter(
        (alert) =>
          alert.stopId === selectedStop.id ||
          distanceInMeters(alert, selectedStop) <= CLUSTER_RADIUS_METERS,
      )
    : [];
  const selectedLiveAlert =
    (selectedLiveAlertId ? rankedAlerts.find((alert) => alert.id === selectedLiveAlertId) : null) ??
    null;
  const nearbyCriticalAlerts = userLocation
    ? rankedAlerts.filter(
        (alert) => distanceInMeters(alert, userLocation) <= NEARBY_WARNING_RADIUS_METERS,
      )
    : [];
  const closestNearbyAlert =
    userLocation && nearbyCriticalAlerts.length > 0
      ? [...nearbyCriticalAlerts].sort(
          (left, right) =>
            distanceInMeters(left, userLocation) - distanceInMeters(right, userLocation),
        )[0]
      : null;
  const reportIsValid = hasSelectedStop && draft.line.trim().length > 0;

  function focusStop(stop: Stop) {
    if (isChoosingNextStop) {
      setDraft((current) => ({
        ...current,
        nextStopId: stop.id,
        nextStopName: stop.name,
      }));
      setChoosingNextStop(false);
      setSelectedStopId(reportOriginStopId || selectedStopId || stop.id);
      setReportModalOpen(true);
      startTransition(() => setActiveTab('map'));
      return;
    }

    setSelectedLiveAlertId(null);
    setSelectedStopId(stop.id);
    setMapRegion(buildRegion(stop.latitude, stop.longitude));
    startTransition(() => setActiveTab('map'));
  }

  function openReportModal(stop: Stop) {
    setReportOriginStopId(stop.id);
    setSelectedStopId(stop.id);
    setDraft({
      direction: '',
      extraInfo: '',
      liveDurationMinutes: 3,
      line: stop.lines[0] ?? '',
      nextStopId: '',
      nextStopName: '',
      occupancy: '3-Mittel',
      shareLiveLocation: false,
      vehicleNumber: '',
    });
    setChoosingNextStop(false);
    setReportModalOpen(true);
  }

  function toggleFavoriteLine(line: string) {
    const normalizedLine = normalizeLineValue(line);

    if (!normalizedLine) {
      return;
    }

    setPreferences((current) => ({
      ...current,
      favoriteLines: toggleArrayValue(current.favoriteLines, normalizedLine).sort((left, right) =>
        left.localeCompare(right),
      ),
    }));
  }

  function addFavoriteLine() {
    const normalizedLine = normalizeLineValue(favoriteLineInput);

    if (!normalizedLine) {
      return;
    }

    setPreferences((current) => ({
      ...current,
      favoriteLines: current.favoriteLines.includes(normalizedLine)
        ? current.favoriteLines
        : [...current.favoriteLines, normalizedLine].sort((left, right) =>
            left.localeCompare(right),
          ),
    }));
    setFavoriteLineInput('');
  }

  function toggleFavoriteStop(stopId: string) {
    setPreferences((current) => ({
      ...current,
      favoriteStopIds: toggleArrayValue(current.favoriteStopIds, stopId),
    }));
  }

  function completeOnboarding() {
    setPreferences((current) => ({
      ...current,
      onboardingCompleted: true,
    }));
  }

  function chooseNextStopFromMap() {
    setChoosingNextStop(true);
    setReportModalOpen(false);
    startTransition(() => setActiveTab('map'));
  }

  function focusCluster(center: Coordinates, stopIds: string[]) {
    const stopCount = stopIds.length;
    const zoomFactor = stopCount > 9 ? 0.34 : stopCount >= 5 ? 0.42 : 0.5;
    const nextRegion = {
      latitude: center.latitude,
      latitudeDelta: Math.max(0.004, mapRegion.latitudeDelta * zoomFactor),
      longitude: center.longitude,
      longitudeDelta: Math.max(0.004, mapRegion.longitudeDelta * zoomFactor),
    };

    setExpandedClusterState({
      collapseLatitudeDelta: Math.max(0.0075, nextRegion.latitudeDelta * 1.9),
      collapseLongitudeDelta: Math.max(0.0075, nextRegion.longitudeDelta * 1.9),
      stopIds,
    });
    setMapRegion(nextRegion);
    startTransition(() => setActiveTab('map'));
  }

  function handleSelectStopId(stopId: string) {
    const stop = stops.find((entry) => entry.id === stopId);

    if (!stop) {
      setSelectedStopId(stopId);
      return;
    }

    focusStop(stop);
  }

  function selectLiveAlert(alertId: string) {
    setSelectedLiveAlertId(alertId);
    startTransition(() => setActiveTab('map'));
  }

  function stopLiveLocation(alertId: string) {
    setAlerts((current) => {
      const updated = current.map((alert) =>
        alert.id === alertId ? { ...alert, liveLocation: undefined } : alert,
      );
      const changedAlert = updated.find((alert) => alert.id === alertId);

      if (changedAlert) {
        publishPeerAlert(changedAlert);
      }

      return mergeAlerts([], updated);
    });
  }

  function submitReport() {
    if (!reportIsValid || !hasSelectedStop) {
      return;
    }

    const nextAlert: Alert = {
      category: 'Stoerung',
      createdAt: new Date().toISOString(),
      direction: draft.direction.trim(),
      extraInfo: draft.extraInfo.trim(),
      id: `alert-${Date.now()}`,
      latitude: selectedStop.latitude,
      line: normalizeLineValue(draft.line),
      liveLocation:
        draft.shareLiveLocation && userLocation
          ? {
              durationMinutes: draft.liveDurationMinutes,
              expiresAt: new Date(
                Date.now() + draft.liveDurationMinutes * 60_000,
              ).toISOString(),
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            }
          : undefined,
      longitude: selectedStop.longitude,
      nextStopId: draft.nextStopId || undefined,
      nextStopName: draft.nextStopName.trim() || undefined,
      occupancy: draft.occupancy,
      ownerId: localPeerId,
      stopId: selectedStop.id,
      stopName: selectedStop.name,
      vehicleNumber: draft.vehicleNumber.trim(),
    };

    publishPeerAlert(nextAlert);

    startTransition(() => {
      setAlerts((current) => mergeAlerts(current, [nextAlert]));
      setActiveTab('alerts');
      setReportModalOpen(false);
    });

    setDraft(EMPTY_DRAFT);
    setReportOriginStopId('');
    setChoosingNextStop(false);
  }

  function focusAlert(alert: Alert) {
    const matchingStop = stops.find((stop) => stop.id === alert.stopId);

    setSelectedLiveAlertId(alert.id);
    setSelectedStopId(matchingStop?.id ?? '');
    setMapRegion(buildRegion(alert.latitude, alert.longitude));
    startTransition(() => setActiveTab('map'));
  }

  const nearbyStopsMessage =
    stopsState === 'loading' && nearbyStops.length === 0
      ? 'Haltestellen im aktuellen Kartenausschnitt werden aus OpenStreetMap geladen.'
      : stopsState === 'loading'
        ? 'Haltestellen im aktuellen Kartenausschnitt werden gerade aktualisiert.'
        : stopsState === 'error' && nearbyStops.length === 0
          ? (stopsError ?? 'Haltestellen konnten gerade nicht geladen werden.')
          : locationState === 'granted'
            ? 'Die Vorschlaege orientieren sich an deinem aktuellen Standort.'
            : 'Ohne Standortfreigabe nutzt die App einen neutralen Startausschnitt rund um Berlin-Mitte.';

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.loadingState}>
          <ActivityIndicator color={PALETTE.accent} size="large" />
          <Text style={styles.loadingTitle}>KontrolRadar wird vorbereitet</Text>
          <Text style={styles.loadingText}>
            Karte, Favoriten und lokale OePNV-Hinweise werden geladen.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      <View style={[styles.container, isWide && styles.containerWide, isDesktop && styles.containerDesktop]}>
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <Text style={styles.eyebrow}>Community fuer neutrale OePNV-Hinweise</Text>
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>KontrolRadar</Text>
              <Text style={styles.subtitle}>
                Live-Karte, 15-Minuten-Warnungen und schnelle Orientierung fuer den Linienverkehr.
              </Text>
            </View>
            <View style={styles.headerPill}>
              <Text style={styles.headerPillValue}>{rankedAlerts.length}</Text>
              <Text style={styles.headerPillLabel}>aktiv</Text>
            </View>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{stops.length}</Text>
              <Text style={styles.metricLabel}>Haltestellen geladen</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{warnedStopIds.length}</Text>
              <Text style={styles.metricLabel}>rot markiert</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{ACTIVE_WINDOW_MINUTES} Min</Text>
              <Text style={styles.metricLabel}>Basis-Laufzeit</Text>
            </View>
          </View>
        </View>

        {closestNearbyAlert ? (
          <View style={styles.proximityBanner}>
            <Text style={styles.proximityBannerTitle}>Rote Nahbereichs-Mitteilung</Text>
            <Text style={styles.proximityBannerText}>
              Eine aktive Warnung liegt in etwa{' '}
              {formatDistance(distanceInMeters(closestNearbyAlert, userLocation ?? referencePoint))}{' '}
              Entfernung bei {closestNearbyAlert.stopName}.
            </Text>
          </View>
        ) : null}

        <View style={styles.tabRow}>
          {TAB_OPTIONS.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tabButton, activeTab === tab.id && styles.tabButtonActive]}
            >
              <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {activeTab === 'map' ? (
          <View style={[styles.mapTab, isDesktop && styles.mapTabDesktop]}>
            <View style={[styles.mapCard, isDesktop && styles.mapCardDesktop]}>
              <TransitMap
                currentRegion={mapRegion}
                locationState={locationState}
                markers={mapMarkers}
                onPressCluster={focusCluster}
                onRegionChange={setMapRegion}
                onSelectLiveAlert={selectLiveAlert}
                onSelectStop={handleSelectStopId}
                userLocation={userLocation}
              />
            </View>

            <ScrollView
              contentContainerStyle={[styles.scrollBody, isDesktop && styles.desktopScrollBody]}
              showsVerticalScrollIndicator={false}
              style={isDesktop ? styles.desktopRail : undefined}
            >
              <View style={styles.surfaceCard}>
                <Text style={styles.sectionTitle}>Nahegelegene Haltestellen</Text>
                <Text style={styles.cardText}>{nearbyStopsMessage}</Text>

                {nearbyStops.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.horizontalChipRow}>
                      {nearbyStops.map((stop) => {
                        const isFavorite = preferences.favoriteStopIds.includes(stop.id);
                        const isWarned = warnedStopIds.includes(stop.id);

                        return (
                          <Pressable
                            key={stop.id}
                            onPress={() => focusStop(stop)}
                            style={[
                              styles.stopChip,
                              isFavorite && styles.stopChipFavorite,
                              isWarned && styles.stopChipWarned,
                            ]}
                          >
                            <Text
                              style={[
                                styles.stopChipTitle,
                                isFavorite && styles.stopChipTitleFavorite,
                                isWarned && styles.stopChipTitleWarned,
                              ]}
                            >
                              {stop.name}
                            </Text>
                            <Text
                              style={[
                                styles.stopChipMeta,
                                isFavorite && styles.stopChipMetaFavorite,
                                isWarned && styles.stopChipMetaWarned,
                              ]}
                            >
                              {formatDistance(distanceInMeters(stop, referencePoint))}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                ) : null}
              </View>

              {isChoosingNextStop ? (
                <View style={styles.surfaceCard}>
                  <Text style={styles.sectionTitle}>Naechste Haltestelle waehlen</Text>
                  <Text style={styles.cardText}>
                    Tippe jetzt in der Karte auf die naechste Haltestelle des Busses. Danach
                    oeffnet sich die Warnmaske wieder automatisch.
                  </Text>
                </View>
              ) : null}

              {selectedLiveAlert && isLiveLocationActive(selectedLiveAlert) ? (
                <View style={styles.surfaceCard}>
                  <Text style={styles.sectionTitle}>Live-Punkt</Text>
                  <Text style={styles.inlineAlertTitle}>{formatAlertHeadline(selectedLiveAlert)}</Text>
                  <Text style={styles.cardText}>
                    {formatAlertDetails(selectedLiveAlert) || 'Live-Signal fuer diese Linie aktiv.'}
                  </Text>
                  {selectedLiveAlert.extraInfo ? (
                    <Text style={styles.cardText}>{selectedLiveAlert.extraInfo}</Text>
                  ) : null}
                  {selectedLiveAlert.ownerId === localPeerId ? (
                    <Pressable
                      onPress={() => stopLiveLocation(selectedLiveAlert.id)}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Live-Punkt beenden</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.surfaceCard}>
                <View style={styles.sectionHeaderRow}>
                  <View>
                    <Text style={styles.sectionTitle}>{selectedStop.name}</Text>
                    <Text style={styles.sectionMeta}>{selectedStop.neighborhood}</Text>
                  </View>
                  <Pressable
                    disabled={!hasSelectedStop}
                    onPress={() => toggleFavoriteStop(selectedStop.id)}
                    style={[
                      styles.secondaryButton,
                      !hasSelectedStop && styles.primaryButtonDisabled,
                      preferences.favoriteStopIds.includes(selectedStop.id) && styles.favoriteButton,
                    ]}
                  >
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        preferences.favoriteStopIds.includes(selectedStop.id) &&
                          styles.favoriteButtonText,
                      ]}
                    >
                      {preferences.favoriteStopIds.includes(selectedStop.id)
                        ? 'Gespeichert'
                        : 'Als Favorit'}
                    </Text>
                  </Pressable>
                </View>

                {selectedStop.lines.length > 0 ? (
                  <View style={styles.chipWrap}>
                    {selectedStop.lines.map((line) => (
                      <View key={line} style={styles.lineChip}>
                        <Text style={styles.lineChipText}>{line}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.cardText}>
                    {hasSelectedStop
                      ? 'Fuer diese Haltestelle sind in OpenStreetMap keine Liniennummern hinterlegt. Du kannst trotzdem eine neutrale Warnung fuer diese Position senden.'
                      : selectedStop.neighborhood}
                  </Text>
                )}

                <Text style={styles.cardText}>
                  {selectedStopAlerts.length > 0
                    ? `${selectedStopAlerts.length} aktive Warnungen im Umfeld dieser Haltestelle.`
                    : 'Aktuell keine aktiven Warnungen im nahen Umfeld.'}
                </Text>

                {selectedStopAlerts.slice(0, 2).map((alert) => (
                  <View key={alert.id} style={styles.inlineAlert}>
                    <Text style={styles.inlineAlertTitle}>{formatAlertHeadline(alert)}</Text>
                    <Text style={styles.inlineAlertMeta}>
                      {formatAlertDetails(alert, formatRelativeTime(alert.ageMinutes))}
                    </Text>
                  </View>
                ))}

                <View style={styles.actionRow}>
                  <Pressable
                    disabled={!hasSelectedStop}
                    onPress={() => openReportModal(selectedStop)}
                    style={[styles.primaryButton, !hasSelectedStop && styles.primaryButtonDisabled]}
                  >
                    <Text style={styles.primaryButtonText}>Linienwarnung melden</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => startTransition(() => setActiveTab('alerts'))}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>Warnliste</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        ) : null}

        {activeTab === 'alerts' ? (
          <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
            <View style={styles.surfaceCard}>
              <Text style={styles.sectionTitle}>Aktuelle Warnungen</Text>
              <Text style={styles.cardText}>
                Priorisiert nach Aktualitaet, Haeufung innerhalb von 5 Minuten und Relevanz fuer
                deine Favoriten. Warnungen laufen nach {ACTIVE_WINDOW_MINUTES} Minuten aus.
              </Text>
              <Text style={styles.cardText}>
                Im Prototyp werden neue Warnungen direkt zwischen offenen Prototyp-Fenstern im
                selben Browser-Profil synchronisiert, ohne zentrale Server-Logik.
              </Text>
            </View>

            {rankedAlerts.map((alert) => (
              <Pressable
                key={alert.id}
                onPress={() => focusAlert(alert)}
                style={styles.alertCard}
              >
                <View style={styles.alertCardTopRow}>
                  <Text style={styles.alertTitle}>{alert.stopName}</Text>
                  <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBadgeText}>Score {alert.score}</Text>
                  </View>
                </View>

                <Text style={styles.alertCategory}>{formatAlertHeadline(alert)}</Text>
                {formatAlertDetails(alert) ? (
                  <Text style={styles.cardText}>{formatAlertDetails(alert)}</Text>
                ) : null}
                {alert.extraInfo ? <Text style={styles.cardText}>{alert.extraInfo}</Text> : null}
                {isLiveLocationActive(alert) ? (
                  <Text style={styles.favoriteMatchPill}>Live-Punkt aktiv</Text>
                ) : null}

                <View style={styles.alertMetaRow}>
                  <Text style={styles.alertMetaText}>{formatRelativeTime(alert.ageMinutes)}</Text>
                  <Text style={styles.alertMetaText}>
                    {alert.clusterCount > 0
                      ? `${alert.clusterCount + 1} Warnungen im Cluster`
                      : 'Einzelwarnung'}
                  </Text>
                  {alert.favoriteMatch ? (
                    <Text style={styles.favoriteMatchPill}>Favorit</Text>
                  ) : null}
                </View>

                {alert.ownerId === localPeerId && isLiveLocationActive(alert) ? (
                  <Pressable
                    onPress={() => stopLiveLocation(alert.id)}
                    style={[styles.secondaryButton, styles.liveStopButton]}
                  >
                    <Text style={styles.secondaryButtonText}>Live-Punkt aus</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            ))}

            {rankedAlerts.length === 0 ? (
              <View style={styles.surfaceCard}>
                <Text style={styles.sectionTitle}>Noch keine aktiven Warnungen</Text>
                <Text style={styles.cardText}>
                  Tippe auf eine Haltestelle in der Karte und sende eine neutrale Warnung.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        {activeTab === 'favorites' ? (
          <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
            <View style={styles.surfaceCard}>
              <Text style={styles.sectionTitle}>Personalisierung</Text>
              <Text style={styles.cardText}>
                Lege Linien und Haltestellen fest, damit spaeter relevante Push-Hinweise zu
                Verspaetungen, Umleitungen, Ausfaellen oder Baustellen moeglich sind.
              </Text>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Benachrichtigungen vormerken</Text>
                  <Text style={styles.toggleCaption}>
                    Im aktuellen Stand lokal gespeichert, spaeter fuer Push-Events nutzbar.
                  </Text>
                </View>
                <Switch
                  onValueChange={(value) =>
                    setPreferences((current) => ({ ...current, notificationsEnabled: value }))
                  }
                  thumbColor={preferences.notificationsEnabled ? PALETTE.card : '#C0C4C7'}
                  trackColor={{ false: '#C9D1D6', true: PALETTE.accent }}
                  value={preferences.notificationsEnabled}
                />
              </View>
            </View>

            <View style={styles.surfaceCard}>
              <Text style={styles.sectionTitle}>Bevorzugte Linien</Text>
              <Text style={styles.cardText}>
                Liniennummern koennen direkt manuell gespeichert werden. Wenn OpenStreetMap an
                Haltestellen Linien hinterlegt, erscheinen sie unten zusaetzlich als Vorschlaege.
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={setFavoriteLineInput}
                  onSubmitEditing={addFavoriteLine}
                  placeholder="z. B. 200 oder M41"
                  placeholderTextColor="#8B9195"
                  style={[styles.input, styles.inputRowField]}
                  value={favoriteLineInput}
                />
                <Pressable
                  disabled={!normalizeLineValue(favoriteLineInput)}
                  onPress={addFavoriteLine}
                  style={[
                    styles.secondaryButton,
                    styles.inputRowButton,
                    !normalizeLineValue(favoriteLineInput) && styles.primaryButtonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Speichern</Text>
                </Pressable>
              </View>

              {preferences.favoriteLines.length > 0 ? (
                <View style={styles.chipWrap}>
                  {preferences.favoriteLines.map((line) => (
                    <Pressable
                      key={line}
                      onPress={() => toggleFavoriteLine(line)}
                      style={[styles.filterChip, styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, styles.filterChipTextActive]}>
                        {line}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.sectionMeta}>Noch keine bevorzugten Linien gespeichert.</Text>
              )}

              {lineOptions.length > 0 ? (
                <>
                  <Text style={styles.sectionMeta}>
                    Vorschlaege aus dem aktuellen Kartenausschnitt
                  </Text>
                  <View style={styles.chipWrap}>
                    {lineOptions.map((line) => {
                      const selected = preferences.favoriteLines.includes(line);

                      return (
                        <Pressable
                          key={line}
                          onPress={() => toggleFavoriteLine(line)}
                          style={[styles.filterChip, selected && styles.filterChipActive]}
                        >
                          <Text
                            style={[styles.filterChipText, selected && styles.filterChipTextActive]}
                          >
                            {line}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text style={styles.sectionMeta}>
                  In den geladenen OSM-Haltestellen sind aktuell keine Liniennummern hinterlegt.
                </Text>
              )}
            </View>

            <View style={styles.surfaceCard}>
              <Text style={styles.sectionTitle}>Haeufig genutzte Haltestellen</Text>
              {stops.length > 0 ? (
                <View style={styles.chipWrap}>
                  {stops.slice(0, 18).map((stop) => {
                    const selected = preferences.favoriteStopIds.includes(stop.id);
                    const warned = warnedStopIds.includes(stop.id);

                    return (
                      <Pressable
                        key={stop.id}
                        onPress={() => toggleFavoriteStop(stop.id)}
                        style={[
                          styles.filterChipWide,
                          selected && styles.filterChipWideActive,
                          warned && styles.stopChipWarned,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipWideText,
                            selected && styles.filterChipWideTextActive,
                            warned && styles.stopChipTitleWarned,
                          ]}
                        >
                          {stop.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.sectionMeta}>
                  {stopsState === 'error'
                    ? (stopsError ?? 'Haltestellen konnten gerade nicht geladen werden.')
                    : 'Sobald Haltestellen aus OpenStreetMap geladen sind, erscheinen sie hier als Vorschlaege.'}
                </Text>
              )}
            </View>

            <Pressable
              onPress={() =>
                setPreferences((current) => ({ ...current, onboardingCompleted: false }))
              }
              style={styles.surfaceCard}
            >
              <Text style={styles.sectionTitle}>Einrichtung erneut oeffnen</Text>
              <Text style={styles.cardText}>
                Nuetzlich, wenn du spaeter andere Heim-, Arbeits- oder Schulhaltestellen festlegen
                willst.
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}
      </View>

      <Modal
        animationType="slide"
        transparent
        visible={!preferences.onboardingCompleted}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.onboardingCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalEyebrow}>Erster Start</Text>
              <Text style={styles.modalTitle}>Lege deine Linien und Haltestellen fest</Text>
              <Text style={styles.modalText}>
                Die App nutzt diese Auswahl spaeter fuer persoenliche Hinweise zu Ausfaellen,
                Baustellen, Umleitungen und Verspaetungen.
              </Text>

              <Text style={styles.modalSectionTitle}>Bevorzugte Linien</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setFavoriteLineInput}
                onSubmitEditing={addFavoriteLine}
                placeholder="z. B. 200 oder M41"
                placeholderTextColor="#8B9195"
                style={styles.input}
                value={favoriteLineInput}
              />

              {preferences.favoriteLines.length > 0 ? (
                <View style={styles.chipWrap}>
                  {preferences.favoriteLines.map((line) => (
                    <Pressable
                      key={line}
                      onPress={() => toggleFavoriteLine(line)}
                      style={[styles.filterChip, styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, styles.filterChipTextActive]}>
                        {line}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.sectionMeta}>Noch keine bevorzugten Linien gespeichert.</Text>
              )}

              {lineOptions.length > 0 ? (
                <View style={styles.chipWrap}>
                  {lineOptions.map((line) => {
                    const selected = preferences.favoriteLines.includes(line);

                    return (
                      <Pressable
                        key={line}
                        onPress={() => toggleFavoriteLine(line)}
                        style={[styles.filterChip, selected && styles.filterChipActive]}
                      >
                        <Text
                          style={[styles.filterChipText, selected && styles.filterChipTextActive]}
                        >
                          {line}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.sectionMeta}>
                  In den geladenen OSM-Haltestellen sind aktuell keine Liniennummern hinterlegt.
                </Text>
              )}

              <Text style={styles.modalSectionTitle}>Nahe Vorschlaege</Text>
              {nearbyStops.length > 0 ? (
                <View style={styles.chipWrap}>
                  {nearbyStops.map((stop) => {
                    const selected = preferences.favoriteStopIds.includes(stop.id);
                    const warned = warnedStopIds.includes(stop.id);

                    return (
                      <Pressable
                        key={stop.id}
                        onPress={() => toggleFavoriteStop(stop.id)}
                        style={[
                          styles.filterChipWide,
                          selected && styles.filterChipWideActive,
                          warned && styles.stopChipWarned,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipWideText,
                            selected && styles.filterChipWideTextActive,
                            warned && styles.stopChipTitleWarned,
                          ]}
                        >
                          {stop.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.sectionMeta}>{nearbyStopsMessage}</Text>
              )}

              <Text style={styles.modalHint}>
                Hinweise bleiben anonym und zeitlich begrenzt. Keine Fotos, Namen oder sonstige
                personenbezogenen Daten.
              </Text>

              <Pressable onPress={completeOnboarding} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Einrichtung abschliessen</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setReportModalOpen(false)}
        transparent
        visible={isReportModalOpen}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.reportCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalEyebrow}>Linienwarnung</Text>
              <Text style={styles.modalTitle}>{selectedStop.name}</Text>
              <Text style={styles.modalText}>
                Diese Aktion speichert eine anonyme, zeitlich begrenzte Warnung fuer die gewaehlte
                Haltestelle. Keine Personenangaben, keine Fotos und kein Tracking von Personen.
              </Text>
              <Text style={styles.modalSectionTitle}>Buslinie</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={(line) => setDraft((current) => ({ ...current, line }))}
                placeholder="z. B. 100, 200 oder M41"
                placeholderTextColor="#8B9195"
                style={styles.input}
                value={draft.line}
              />
              {selectedStop.lines.length > 0 ? (
                <View style={styles.chipWrap}>
                  {selectedStop.lines.map((line) => (
                    <Pressable
                      key={line}
                      onPress={() => setDraft((current) => ({ ...current, line }))}
                      style={[
                        styles.filterChip,
                        normalizeLineValue(draft.line) === normalizeLineValue(line) &&
                          styles.filterChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          normalizeLineValue(draft.line) === normalizeLineValue(line) &&
                            styles.filterChipTextActive,
                        ]}
                      >
                        {line}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text style={styles.modalSectionTitle}>Naechste Haltestelle (optional)</Text>
              <Pressable
                onPress={chooseNextStopFromMap}
                style={[styles.secondaryButton, styles.modalStandaloneButton]}
              >
                <Text style={styles.secondaryButtonText}>
                  {draft.nextStopName
                    ? `Ausgewaehlt: ${draft.nextStopName}`
                    : 'Auf der Karte auswaehlen'}
                </Text>
              </Pressable>

              <Text style={styles.modalSectionTitle}>Wie voll war der Bus?</Text>
              <View style={styles.chipWrap}>
                {OCCUPANCY_OPTIONS.map((option) => {
                  const selected = draft.occupancy === option;

                  return (
                    <Pressable
                      key={option}
                      onPress={() => setDraft((current) => ({ ...current, occupancy: option }))}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.modalSectionTitle}>Modell- oder Fahrzeugnummer (optional)</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={(vehicleNumber) =>
                  setDraft((current) => ({ ...current, vehicleNumber }))
                }
                placeholder="z. B. MAN 293 oder Wagen 8123"
                placeholderTextColor="#8B9195"
                style={styles.input}
                value={draft.vehicleNumber}
              />

              <Text style={styles.modalSectionTitle}>Zusatzinformation (optional)</Text>
              <TextInput
                autoCorrect={false}
                multiline
                onChangeText={(extraInfo) => setDraft((current) => ({ ...current, extraInfo }))}
                placeholder="z. B. Bus stand noch an der Haltestelle. Bitte keine Personenangaben."
                placeholderTextColor="#8B9195"
                style={[styles.input, styles.textAreaInput]}
                value={draft.extraInfo}
              />

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Live-Punkt teilen</Text>
                  <Text style={styles.toggleCaption}>
                    Optionaler roter Punkt mit deiner aktuellen Busposition fuer andere Nutzer.
                  </Text>
                </View>
                <Switch
                  disabled={!userLocation}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, shareLiveLocation: value }))
                  }
                  thumbColor={draft.shareLiveLocation ? PALETTE.card : '#C0C4C7'}
                  trackColor={{ false: '#C9D1D6', true: PALETTE.alert }}
                  value={draft.shareLiveLocation && !!userLocation}
                />
              </View>

              {draft.shareLiveLocation && userLocation ? (
                <>
                  <Text style={styles.modalSectionTitle}>Wie lange sichtbar?</Text>
                  <View style={styles.chipWrap}>
                    {LIVE_DURATION_OPTIONS.map((minutes) => {
                      const selected = draft.liveDurationMinutes === minutes;

                      return (
                        <Pressable
                          key={minutes}
                          onPress={() =>
                            setDraft((current) => ({ ...current, liveDurationMinutes: minutes }))
                          }
                          style={[styles.filterChip, selected && styles.filterChipActive]}
                        >
                          <Text
                            style={[styles.filterChipText, selected && styles.filterChipTextActive]}
                          >
                            {minutes} Min
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : !userLocation ? (
                <Text style={styles.sectionMeta}>
                  Ohne Standortfreigabe kann kein Live-Punkt geteilt werden.
                </Text>
              ) : null}

              <Text style={styles.modalHint}>
                Die Warnung wird lokal und im offenen Peer-Prototyp geteilt und verliert nach
                {` ${ACTIVE_WINDOW_MINUTES} `}Minuten deutlich an Gewicht.
              </Text>

              <View style={styles.actionRow}>
                <Pressable onPress={() => setReportModalOpen(false)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Abbrechen</Text>
                </Pressable>
                <Pressable
                  disabled={!reportIsValid}
                  onPress={submitReport}
                  style={[styles.primaryButton, !reportIsValid && styles.primaryButtonDisabled]}
                >
                  <Text style={styles.primaryButtonText}>Linienwarnung senden</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  alertCard: {
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  alertCardTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  alertCategory: {
    color: PALETTE.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  alertMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  alertMetaText: {
    color: PALETTE.muted,
    fontSize: 13,
    fontWeight: '500',
  },
  alertTitle: {
    color: PALETTE.ink,
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    paddingRight: 12,
  },
  cardText: {
    color: PALETTE.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  container: {
    backgroundColor: PALETTE.background,
    flex: 1,
    gap: 16,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  containerDesktop: {
    paddingBottom: 18,
  },
  containerWide: {
    alignSelf: 'center',
    maxWidth: 1380,
    width: '100%',
  },
  desktopRail: {
    flex: 0.82,
    minWidth: 360,
  },
  desktopScrollBody: {
    paddingBottom: 0,
  },
  favoriteButton: {
    backgroundColor: PALETTE.successSoft,
    borderColor: PALETTE.success,
  },
  favoriteButtonText: {
    color: PALETTE.success,
  },
  favoriteMatchPill: {
    backgroundColor: PALETTE.successSoft,
    borderRadius: 999,
    color: PALETTE.success,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  filterChip: {
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: PALETTE.accent,
    borderColor: PALETTE.accent,
  },
  filterChipText: {
    color: PALETTE.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: PALETTE.card,
  },
  filterChipWide: {
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  filterChipWideActive: {
    backgroundColor: PALETTE.accentSoft,
    borderColor: PALETTE.accent,
  },
  filterChipWideText: {
    color: PALETTE.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  filterChipWideTextActive: {
    color: PALETTE.accent,
  },
  header: {
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 28,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  headerDesktop: {
    paddingHorizontal: 26,
    paddingVertical: 24,
  },
  headerPill: {
    alignItems: 'center',
    backgroundColor: PALETTE.accent,
    borderRadius: 22,
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerPillLabel: {
    color: PALETTE.card,
    fontSize: 12,
    fontWeight: '600',
  },
  headerPillValue: {
    color: PALETTE.card,
    fontSize: 22,
    fontWeight: '900',
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerTextWrap: {
    flex: 1,
    gap: 6,
  },
  horizontalChipRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    backgroundColor: '#F3F7F7',
    borderColor: '#E0E7E8',
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 112,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  metricLabel: {
    color: PALETTE.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  metricValue: {
    color: PALETTE.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  eyebrow: {
    color: PALETTE.muted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  inlineAlert: {
    backgroundColor: '#F3F6F7',
    borderRadius: 18,
    gap: 4,
    padding: 14,
  },
  inlineAlertMeta: {
    color: PALETTE.muted,
    fontSize: 13,
    fontWeight: '500',
  },
  inlineAlertTitle: {
    color: PALETTE.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#F8F6F1',
    borderColor: PALETTE.border,
    borderRadius: 18,
    borderWidth: 1,
    color: PALETTE.ink,
    fontSize: 15,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inputRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 12,
  },
  inputRowButton: {
    flex: 0,
    minWidth: 116,
  },
  inputRowField: {
    flex: 1,
    marginTop: 0,
  },
  liveStopButton: {
    flex: 0,
    marginTop: 10,
  },
  lineChip: {
    backgroundColor: PALETTE.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  lineChipText: {
    color: PALETTE.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  loadingState: {
    alignItems: 'center',
    backgroundColor: PALETTE.background,
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  loadingText: {
    color: PALETTE.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  loadingTitle: {
    color: PALETTE.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  map: {
    flex: 1,
  },
  mapCard: {
    borderRadius: 28,
    flex: 0.95,
    minHeight: 340,
    overflow: 'hidden',
  },
  mapCardDesktop: {
    flex: 1.18,
    minHeight: 720,
  },
  mapTab: {
    flex: 1,
    gap: 16,
  },
  mapTabDesktop: {
    alignItems: 'stretch',
    flexDirection: 'row',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(20, 33, 43, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalEyebrow: {
    color: PALETTE.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  modalHint: {
    color: PALETTE.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 18,
  },
  modalSectionTitle: {
    color: PALETTE.ink,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 22,
  },
  modalStandaloneButton: {
    flex: 0,
    marginTop: 4,
  },
  modalText: {
    color: PALETTE.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  modalTitle: {
    color: PALETTE.ink,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
    marginTop: 8,
  },
  onboardingCard: {
    backgroundColor: PALETTE.card,
    borderRadius: 32,
    maxHeight: '88%',
    padding: 22,
    width: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.accent,
    borderRadius: 18,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: PALETTE.card,
    fontSize: 15,
    fontWeight: '800',
  },
  proximityBanner: {
    backgroundColor: '#A64B42',
    borderRadius: 24,
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  proximityBannerText: {
    color: '#FFF3F1',
    fontSize: 14,
    lineHeight: 20,
  },
  proximityBannerTitle: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
  },
  reportCard: {
    backgroundColor: PALETTE.card,
    borderRadius: 32,
    maxHeight: '88%',
    padding: 22,
    width: '100%',
  },
  safeArea: {
    backgroundColor: PALETTE.background,
    flex: 1,
  },
  scoreBadge: {
    backgroundColor: '#E8ECEE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scoreBadgeText: {
    color: PALETTE.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  scrollBody: {
    gap: 14,
    paddingBottom: 28,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: PALETTE.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  sectionMeta: {
    color: PALETTE.muted,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  sectionTitle: {
    color: PALETTE.ink,
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
  },
  stopChip: {
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 148,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stopChipFavorite: {
    backgroundColor: PALETTE.accentSoft,
    borderColor: PALETTE.accent,
  },
  stopChipMetaWarned: {
    color: PALETTE.alert,
  },
  stopChipMeta: {
    color: PALETTE.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  stopChipMetaFavorite: {
    color: PALETTE.accent,
  },
  stopChipTitle: {
    color: PALETTE.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  stopChipTitleFavorite: {
    color: PALETTE.accent,
  },
  stopChipTitleWarned: {
    color: PALETTE.alert,
  },
  stopChipWarned: {
    backgroundColor: '#FFF1F0',
    borderColor: '#D07C74',
  },
  textAreaInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  subtitle: {
    color: PALETTE.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  surfaceCard: {
    backgroundColor: PALETTE.card,
    borderColor: PALETTE.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    paddingVertical: 12,
  },
  tabButtonActive: {
    backgroundColor: PALETTE.accent,
  },
  tabLabel: {
    color: PALETTE.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: PALETTE.card,
  },
  tabRow: {
    backgroundColor: '#E2E6E6',
    borderRadius: 999,
    flexDirection: 'row',
    padding: 4,
  },
  title: {
    color: PALETTE.ink,
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 36,
  },
  toggleCaption: {
    color: PALETTE.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  toggleTextWrap: {
    flex: 1,
    gap: 4,
  },
  toggleTitle: {
    color: PALETTE.ink,
    fontSize: 15,
    fontWeight: '800',
  },
});
