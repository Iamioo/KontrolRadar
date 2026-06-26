import type { Coordinates, MapMarker, MapRegion } from '../types';

export type TransitMapProps = {
  currentRegion: MapRegion;
  locationState: 'loading' | 'granted' | 'denied';
  markers: MapMarker[];
  onPressCluster: (center: Coordinates, stopIds: string[]) => void;
  onRegionChange: (region: MapRegion) => void;
  onSelectLiveAlert: (alertId: string) => void;
  onSelectStop: (stopId: string) => void;
  userLocation: Coordinates | null;
};
