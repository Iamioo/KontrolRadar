export type Stop = {
  id: string;
  latitude: number;
  lines: string[];
  longitude: number;
  name: string;
  neighborhood: string;
};

export type OccupancyLevel =
  | '1-Leer'
  | '2-Eher leer'
  | '3-Mittel'
  | '4-Voll'
  | '5-Sehr voll';

export type StopMarker = {
  type: 'stop';
  favorite: boolean;
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  selected: boolean;
  stopId: string;
  warned: boolean;
};

export type StopClusterMarker = {
  type: 'cluster';
  count: number;
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  stopIds: string[];
  warned: boolean;
};

export type LiveMapMarker = {
  type: 'live';
  alertId: string;
  id: string;
  label: string;
  latitude: number;
  line: string;
  longitude: number;
  warned: boolean;
};

export type MapMarker = StopMarker | StopClusterMarker | LiveMapMarker;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type MapRegion = Coordinates & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type AlertCategory =
  | 'Barrierefrei'
  | 'Baustelle'
  | 'Ausfall'
  | 'Stoerung'
  | 'Ueberfuellung'
  | 'Umleitung'
  | 'Verspaetung';

export type Alert = {
  category: AlertCategory;
  createdAt: string;
  direction: string;
  extraInfo?: string;
  id: string;
  latitude: number;
  line: string;
  liveLocation?: {
    durationMinutes: number;
    expiresAt: string;
    latitude: number;
    longitude: number;
  };
  longitude: number;
  nextStopId?: string;
  nextStopName?: string;
  occupancy?: OccupancyLevel;
  ownerId?: string;
  stopId: string;
  stopName: string;
  vehicleNumber?: string;
};

export type RankedAlert = Alert & {
  ageMinutes: number;
  clusterCount: number;
  favoriteMatch: boolean;
  score: number;
};

export type Preferences = {
  favoriteLines: string[];
  favoriteStopIds: string[];
  notificationsEnabled: boolean;
  onboardingCompleted: boolean;
};

export type ReportDraft = {
  direction: string;
  extraInfo: string;
  liveDurationMinutes: number;
  line: string;
  nextStopId: string;
  nextStopName: string;
  occupancy: OccupancyLevel;
  shareLiveLocation: boolean;
  vehicleNumber: string;
};
