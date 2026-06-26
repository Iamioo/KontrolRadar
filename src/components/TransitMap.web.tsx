import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

import type { MapMarker, MapRegion } from '../types';
import type { TransitMapProps } from './TransitMap.types';

const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const COLORS = {
  accent: '#0F4C5C',
  alert: '#A64B42',
  ink: '#14212B',
  muted: '#64717A',
  cluster: 'rgba(123, 128, 133, 0.72)',
  surface: 'rgba(252, 251, 247, 0.96)',
  user: '#627F2C',
};

function zoomFromRegion(region: MapRegion) {
  return Math.max(4, Math.min(17, Math.log2(360 / region.longitudeDelta)));
}

function regionFromMap(map: maplibregl.Map): MapRegion {
  const center = map.getCenter();
  const bounds = map.getBounds();

  return {
    latitude: center.lat,
    latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
    longitude: center.lng,
    longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest()),
  };
}

function regionsAreClose(left: MapRegion, right: MapRegion) {
  return (
    Math.abs(left.latitude - right.latitude) < 0.0002 &&
    Math.abs(left.longitude - right.longitude) < 0.0002 &&
    Math.abs(left.latitudeDelta - right.latitudeDelta) < 0.0008 &&
    Math.abs(left.longitudeDelta - right.longitudeDelta) < 0.0008
  );
}

function createMarkerElement(marker: MapMarker) {
  const button = document.createElement('button');
  button.type = 'button';
  button.style.cursor = 'pointer';
  button.style.margin = '0';
  button.style.padding = '0';

  if (marker.type === 'cluster') {
    const size = marker.count > 9 ? 54 : marker.count >= 5 ? 50 : 46;
    button.style.alignItems = 'center';
    button.style.background = marker.warned ? COLORS.alert : COLORS.cluster;
    button.style.backdropFilter = 'blur(2px)';
    button.style.border = '2px solid rgba(255,255,255,0.92)';
    button.style.borderRadius = '999px';
    button.style.boxShadow = '0 10px 22px rgba(20, 33, 43, 0.18)';
    button.style.color = 'white';
    button.style.display = 'flex';
    button.style.fontSize = '22px';
    button.style.fontWeight = '800';
    button.style.height = `${size}px`;
    button.style.justifyContent = 'center';
    button.style.lineHeight = '1';
    button.style.width = `${size}px`;
    button.textContent = marker.label;
    return button;
  }

  if (marker.type === 'live') {
    button.style.alignItems = 'center';
    button.style.background = 'transparent';
    button.style.border = '0';
    button.style.display = 'flex';
    button.style.flexDirection = 'column';
    button.style.padding = '4px';

    const dot = document.createElement('span');
    dot.style.background = COLORS.alert;
    dot.style.border = '3px solid white';
    dot.style.borderRadius = '999px';
    dot.style.boxShadow = '0 0 0 4px rgba(166, 75, 66, 0.22)';
    dot.style.display = 'block';
    dot.style.height = '18px';
    dot.style.width = '18px';

    const label = document.createElement('span');
    label.textContent = marker.line || 'Live';
    label.style.background = 'rgba(255,255,255,0.92)';
    label.style.borderRadius = '999px';
    label.style.color = COLORS.alert;
    label.style.display = 'block';
    label.style.fontSize = '10px';
    label.style.fontWeight = '800';
    label.style.lineHeight = '12px';
    label.style.marginTop = '6px';
    label.style.padding = '3px 8px';

    button.appendChild(dot);
    button.appendChild(label);
    return button;
  }

  button.style.alignItems = 'center';
  button.style.background = marker.selected
    ? COLORS.ink
    : marker.warned
      ? 'rgba(255,255,255,0.94)'
      : marker.favorite
        ? 'rgba(255,255,255,0.9)'
        : 'transparent';
  button.style.border = '0';
  button.style.borderRadius = '16px';
  button.style.display = 'flex';
  button.style.flexDirection = 'column';
  button.style.padding = '6px';

  const dot = document.createElement('span');
  dot.style.background = marker.warned ? COLORS.alert : marker.favorite ? COLORS.alert : COLORS.accent;
  dot.style.border = marker.warned ? '3px solid #FFE6E3' : '2px solid white';
  dot.style.borderRadius = '999px';
  dot.style.boxSizing = 'border-box';
  dot.style.boxShadow = marker.warned ? '0 0 0 4px rgba(166, 75, 66, 0.14)' : 'none';
  dot.style.display = 'block';
  dot.style.height = marker.warned ? '18px' : '14px';
  dot.style.width = marker.warned ? '18px' : '14px';

  const label = document.createElement('span');
  label.textContent = marker.label;
  label.style.color = marker.selected
    ? 'white'
    : marker.warned
      ? COLORS.alert
      : marker.favorite
        ? COLORS.alert
        : COLORS.ink;
  label.style.display = 'block';
  label.style.fontSize = '11px';
  label.style.fontWeight = '800';
  label.style.lineHeight = '14px';
  label.style.marginTop = '4px';
  label.style.maxWidth = '94px';
  label.style.textAlign = 'center';
  label.style.textWrap = 'balance';

  button.appendChild(dot);
  button.appendChild(label);

  return button;
}

export default function TransitMap({
  currentRegion,
  locationState,
  markers,
  onPressCluster,
  onRegionChange,
  onSelectLiveAlert,
  onSelectStop,
  userLocation,
}: TransitMapProps) {
  const initialRegionRef = useRef(currentRegion);
  const latestRegionRef = useRef(currentRegion);
  const isApplyingExternalRegionRef = useRef(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    latestRegionRef.current = currentRegion;
  }, [currentRegion]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const initialRegion = initialRegionRef.current;
    const map = new maplibregl.Map({
      attributionControl: { compact: true },
      center: [initialRegion.longitude, initialRegion.latitude],
      container: mapContainerRef.current,
      style: OPEN_FREE_MAP_STYLE,
      zoom: zoomFromRegion(initialRegion),
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('moveend', () => {
      const nextRegion = regionFromMap(map);

      if (isApplyingExternalRegionRef.current && regionsAreClose(nextRegion, latestRegionRef.current)) {
        isApplyingExternalRegionRef.current = false;
        return;
      }

      isApplyingExternalRegionRef.current = false;

      if (!regionsAreClose(nextRegion, latestRegionRef.current)) {
        onRegionChange(nextRegion);
      }
    });
    mapRef.current = map;

    return () => {
      userMarkerRef.current?.remove();
      stopMarkersRef.current.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [onRegionChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const liveRegion = regionFromMap(map);
    if (regionsAreClose(liveRegion, currentRegion)) {
      return;
    }

    isApplyingExternalRegionRef.current = true;
    map.easeTo({
      center: [currentRegion.longitude, currentRegion.latitude],
      duration: 450,
      zoom: zoomFromRegion(currentRegion),
    });
  }, [currentRegion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    stopMarkersRef.current.forEach((marker) => marker.remove());
    stopMarkersRef.current = markers.map((mapMarker) => {
      const markerInstance = new maplibregl.Marker({
        anchor: 'bottom',
        element: createMarkerElement(mapMarker),
      })
        .setLngLat([mapMarker.longitude, mapMarker.latitude])
        .addTo(map);

      markerInstance.getElement().addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (mapMarker.type === 'cluster') {
          onPressCluster(
            {
              latitude: mapMarker.latitude,
              longitude: mapMarker.longitude,
            },
            mapMarker.stopIds,
          );
          return;
        }

        if (mapMarker.type === 'live') {
          onSelectLiveAlert(mapMarker.alertId);
          return;
        }

        onSelectStop(mapMarker.stopId);
      });

      return markerInstance;
    });
  }, [markers, onPressCluster, onSelectLiveAlert, onSelectStop]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;

    if (!userLocation) {
      return;
    }

    const element = document.createElement('span');
    element.style.background = COLORS.user;
    element.style.border = '3px solid white';
    element.style.borderRadius = '999px';
    element.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.18)';
    element.style.display = 'block';
    element.style.height = '18px';
    element.style.width = '18px';

    userMarkerRef.current = new maplibregl.Marker({ element })
      .setLngLat([userLocation.longitude, userLocation.latitude])
      .addTo(map);
  }, [userLocation]);

  return (
    <div
      style={{
        borderRadius: 28,
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <div ref={mapContainerRef} style={{ height: '100%', width: '100%' }} />

      <div
        style={{
          background: COLORS.surface,
          border: '1px solid #D5D0C4',
          borderRadius: 18,
          boxSizing: 'border-box',
          left: 16,
          maxWidth: 320,
          padding: 14,
          position: 'absolute',
          top: 16,
          zIndex: 5,
        }}
      >
        <div style={{ color: COLORS.ink, fontSize: 15, fontWeight: 800 }}>OpenFreeMap</div>
        <div style={{ color: COLORS.muted, fontSize: 13, lineHeight: '18px', marginTop: 6 }}>
          Die Web-Karte nutzt die offizielle OpenFreeMap-MapLibre-Style-URL und bleibt voll
          anklickbar fuer Haltestellen.
        </div>
        <div
          style={{
            color: COLORS.accent,
            fontSize: 12,
            fontWeight: 700,
            lineHeight: '17px',
            marginTop: 8,
          }}
        >
          {locationState === 'granted'
            ? 'Dein Standort ist als gruener Punkt markiert.'
            : 'Ohne Standortfreigabe startet die Karte im neutralen Startausschnitt rund um Berlin-Mitte.'}
        </div>
      </div>
    </div>
  );
}
