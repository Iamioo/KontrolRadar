import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { TransitMapProps } from './TransitMap.types';

const MAPLIBRE_VERSION = '5.24.0';
const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function buildStaticMapHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    />
    <link
      rel="stylesheet"
      href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css"
    />
    <style>
      html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
      body { overflow: hidden; background: #EAF1EC; }
      .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { bottom: 10px; }
      .marker-button {
        border: 0;
        cursor: pointer;
        margin: 0;
        padding: 0;
      }
      .stop-marker {
        align-items: center;
        background: transparent;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        padding: 6px;
      }
      .stop-marker.favorite { background: rgba(255,255,255,0.84); }
      .stop-marker.warned { background: rgba(255,255,255,0.94); }
      .stop-marker.selected { background: #14212B; }
      .stop-dot {
        background: #0F4C5C;
        border: 2px solid white;
        border-radius: 999px;
        box-sizing: border-box;
        display: block;
        height: 14px;
        width: 14px;
      }
      .stop-dot.warned {
        background: #A64B42;
        border: 3px solid #FFE6E3;
        box-shadow: 0 0 0 4px rgba(166,75,66,0.14);
        height: 18px;
        width: 18px;
      }
      .stop-dot.favorite { background: #A64B42; }
      .stop-label {
        color: #14212B;
        display: block;
        font-size: 11px;
        font-weight: 700;
        line-height: 14px;
        margin-top: 4px;
        max-width: 86px;
        text-align: center;
      }
      .stop-label.warned { color: #A64B42; font-weight: 800; max-width: 94px; }
      .stop-label.favorite { color: #A64B42; }
      .stop-label.selected { color: white; }
      .cluster-marker {
        align-items: center;
        background: rgba(123,128,133,0.72);
        backdrop-filter: blur(2px);
        border: 2px solid rgba(255,255,255,0.92);
        border-radius: 999px;
        box-shadow: 0 10px 22px rgba(20,33,43,0.18);
        color: white;
        display: flex;
        font-size: 22px;
        font-weight: 800;
        justify-content: center;
        line-height: 1;
      }
      .cluster-marker.warned { background: #A64B42; }
      .live-marker {
        align-items: center;
        background: transparent;
        display: flex;
        flex-direction: column;
        padding: 4px;
      }
      .live-dot {
        background: #A64B42;
        border: 3px solid white;
        border-radius: 999px;
        box-shadow: 0 0 0 4px rgba(166,75,66,0.22);
        height: 18px;
        width: 18px;
      }
      .live-label {
        background: rgba(255,255,255,0.92);
        border-radius: 999px;
        color: #A64B42;
        font-size: 10px;
        font-weight: 800;
        line-height: 12px;
        margin-top: 6px;
        padding: 3px 8px;
      }
      .user-marker {
        background: #627F2C;
        border: 3px solid white;
        border-radius: 999px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.18);
        height: 18px;
        width: 18px;
      }
      .legend {
        background: rgba(252,251,247,0.96);
        border: 1px solid #D5D0C4;
        border-radius: 16px;
        left: 12px;
        max-width: 260px;
        padding: 12px;
        position: absolute;
        top: 12px;
        z-index: 5;
      }
      .legend-title { color: #14212B; font-size: 15px; font-weight: 800; }
      .legend-text { color: #64717A; font-size: 12px; line-height: 17px; margin-top: 6px; }
      .legend-hint { color: #0F4C5C; font-size: 12px; font-weight: 700; line-height: 17px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <div class="legend">
      <div class="legend-title">OpenFreeMap</div>
      <div class="legend-text">Mobile Ansicht mit eingebetteter OpenFreeMap-Karte fuer den Expo-Prototyp.</div>
      <div id="legend-hint" class="legend-hint">Die Karte wird vorbereitet.</div>
    </div>

    <script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
    <script>
      function postMessage(payload) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      function zoomFromLongitudeDelta(delta) {
        return Math.max(4, Math.min(17, Math.log2(360 / delta)));
      }

      function regionsAreClose(left, right) {
        return (
          Math.abs(left.latitude - right.latitude) < 0.0002 &&
          Math.abs(left.longitude - right.longitude) < 0.0002 &&
          Math.abs(left.latitudeDelta - right.latitudeDelta) < 0.0008 &&
          Math.abs(left.longitudeDelta - right.longitudeDelta) < 0.0008
        );
      }

      function regionFromMap(map) {
        const center = map.getCenter();
        const bounds = map.getBounds();

        return {
          latitude: center.lat,
          latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
          longitude: center.lng,
          longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest()),
        };
      }

      function createMapMarker(marker) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'marker-button';

        if (marker.type === 'cluster') {
          const size = marker.count > 9 ? 54 : marker.count >= 5 ? 50 : 46;
          button.className += ' cluster-marker' + (marker.warned ? ' warned' : '');
          button.style.height = size + 'px';
          button.style.width = size + 'px';
          button.textContent = marker.label;
        } else if (marker.type === 'live') {
          button.className += ' live-marker';

          const dot = document.createElement('span');
          dot.className = 'live-dot';

          const label = document.createElement('span');
          label.className = 'live-label';
          label.textContent = marker.line || 'Live';

          button.appendChild(dot);
          button.appendChild(label);
        } else {
          button.className +=
            ' stop-marker' +
            (marker.favorite ? ' favorite' : '') +
            (marker.warned ? ' warned' : '') +
            (marker.selected ? ' selected' : '');

          const dot = document.createElement('span');
          dot.className =
            'stop-dot' +
            (marker.favorite ? ' favorite' : '') +
            (marker.warned ? ' warned' : '');

          const label = document.createElement('span');
          label.className =
            'stop-label' +
            (marker.favorite ? ' favorite' : '') +
            (marker.warned ? ' warned' : '') +
            (marker.selected ? ' selected' : '');
          label.textContent = marker.label;

          button.appendChild(dot);
          button.appendChild(label);
        }

        button.addEventListener('click', function(event) {
          event.preventDefault();
          event.stopPropagation();

          if (marker.type === 'cluster') {
            postMessage({
              type: 'selectCluster',
              center: { latitude: marker.latitude, longitude: marker.longitude },
              stopIds: marker.stopIds,
            });
            return;
          }

          if (marker.type === 'live') {
            postMessage({ type: 'selectLiveAlert', alertId: marker.alertId });
            return;
          }

          postMessage({ type: 'selectStop', stopId: marker.stopId });
        });

        return new maplibregl.Marker({
          anchor: 'bottom',
          element: button,
        }).setLngLat([marker.longitude, marker.latitude]);
      }

      window.__kontrolRadarMap = {
        currentRegion: null,
        map: null,
        pendingPayload: null,
        stopMarkers: [],
        userMarker: null,
        update(payload) {
          if (!this.map) {
            this.pendingPayload = payload;
            return;
          }

          const targetRegion = {
            latitude: payload.latitude,
            latitudeDelta: payload.latitudeDelta,
            longitude: payload.longitude,
            longitudeDelta: payload.longitudeDelta,
          };

          document.getElementById('legend-hint').textContent =
            payload.locationState === 'granted'
              ? 'Dein Standort ist als gruener Punkt markiert.'
              : 'Ohne Standortfreigabe startet die Karte im neutralen Startausschnitt rund um Berlin-Mitte.';

          const liveRegion = regionFromMap(this.map);
          if (!regionsAreClose(liveRegion, targetRegion)) {
            this.currentRegion = targetRegion;
            this.map.easeTo({
              center: [payload.longitude, payload.latitude],
              duration: 450,
              zoom: zoomFromLongitudeDelta(payload.longitudeDelta),
            });
          }

          this.stopMarkers.forEach((marker) => marker.remove());
          this.stopMarkers = payload.markers.map((marker) =>
            createMapMarker(marker).addTo(this.map)
          );

          if (this.userMarker) {
            this.userMarker.remove();
            this.userMarker = null;
          }

          if (payload.userLocation) {
            const userMarker = document.createElement('span');
            userMarker.className = 'user-marker';
            this.userMarker = new maplibregl.Marker({ element: userMarker })
              .setLngLat([payload.userLocation.longitude, payload.userLocation.latitude])
              .addTo(this.map);
          }
        },
      };

      const map = new maplibregl.Map({
        attributionControl: true,
        center: [13.4095, 52.52035],
        container: 'map',
        style: '${OPEN_FREE_MAP_STYLE}',
        zoom: 13,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('moveend', function() {
        const region = regionFromMap(map);
        if (
          window.__kontrolRadarMap.currentRegion &&
          regionsAreClose(region, window.__kontrolRadarMap.currentRegion)
        ) {
          return;
        }

        postMessage({ type: 'regionChange', region: region });
      });

      window.__kontrolRadarMap.map = map;
      postMessage({ type: 'ready' });

      if (window.__kontrolRadarMap.pendingPayload) {
        window.__kontrolRadarMap.update(window.__kontrolRadarMap.pendingPayload);
        window.__kontrolRadarMap.pendingPayload = null;
      }
    </script>
  </body>
</html>`;
}

function zoomFromRegion(longitudeDelta: number) {
  return Math.max(4, Math.min(17, Math.log2(360 / longitudeDelta)));
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
  const [isReady, setReady] = useState(false);
  const html = useMemo(() => buildStaticMapHtml(), []);
  const webViewRef = useRef<WebView | null>(null);

  const payload = useMemo(
    () =>
      JSON.stringify({
        latitude: currentRegion.latitude,
        latitudeDelta: currentRegion.latitudeDelta,
        locationState,
        markers,
        longitude: currentRegion.longitude,
        longitudeDelta: currentRegion.longitudeDelta,
        userLocation,
        zoom: zoomFromRegion(currentRegion.longitudeDelta),
      }).replace(/</g, '\\u003c'),
    [
      currentRegion.latitude,
      currentRegion.latitudeDelta,
      currentRegion.longitude,
      currentRegion.longitudeDelta,
      locationState,
      markers,
      userLocation,
    ],
  );

  useEffect(() => {
    if (!isReady || !webViewRef.current) {
      return;
    }

    webViewRef.current.injectJavaScript(`window.__kontrolRadarMap.update(${payload}); true;`);
  }, [isReady, payload]);

  return (
    <View style={styles.container}>
      <WebView
        domStorageEnabled
        javaScriptEnabled
        onLoadEnd={() => setReady(true)}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data) as {
              center?: { latitude: number; longitude: number };
              region?: TransitMapProps['currentRegion'];
              alertId?: string;
              stopIds?: string[];
              stopId?: string;
              type?: string;
            };

            if (payload.type === 'ready') {
              setReady(true);
              return;
            }

            if (payload.type === 'regionChange' && payload.region) {
              onRegionChange(payload.region);
              return;
            }

            if (payload.type === 'selectStop' && payload.stopId) {
              onSelectStop(payload.stopId);
              return;
            }

            if (payload.type === 'selectCluster' && payload.center && payload.stopIds) {
              onPressCluster(payload.center, payload.stopIds);
              return;
            }

            if (payload.type === 'selectLiveAlert' && payload.alertId) {
              onSelectLiveAlert(payload.alertId);
            }
          } catch {
            return;
          }
        }}
        originWhitelist={['*']}
        ref={webViewRef}
        setSupportMultipleWindows={false}
        source={{ html }}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    backgroundColor: '#EAF1EC',
    flex: 1,
  },
});
