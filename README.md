# KontrolRadar

KontrolRadar ist ein neutraler Expo-Prototyp fuer eine mobile OePNV-App mit Karte, Haltestellen, Favoriten und strukturierten Community-Hinweisen zu Stoerungen wie Verspaetungen, Umleitungen, Ausfaellen oder Baustellen.

## Was schon drin ist

- Interaktive Kartenansicht mit `OpenFreeMap`
- Standortabfrage fuer nahegelegene Haltestellen-Vorschlaege
- Ersteinrichtung fuer bevorzugte Linien und haeufig genutzte Haltestellen
- Lokaler Meldedialog mit manueller Linieneingabe, Auslastung, naechster Haltestelle, optionaler Fahrzeugnummer und Zusatzinfo
- Leerer Start ohne vorinstallierte Demo-Meldungen
- Direkter Prototyp-Sync fuer neue Meldungen zwischen offenen Browser-Fenstern im selben Profil
- Priorisierte Meldeliste mit 5-Minuten-Clusterlogik und Basis-Laufzeit von 15 Minuten
- Lokales Speichern von Favoriten und Meldungen per `AsyncStorage`
- Tippbare Zahlblasen auf der Karte, die nahe Haltestellen beim Hineinzoomen aufklappen

## Schnell starten

1. Stelle sicher, dass `Node.js` installiert ist.
2. Optional: aktualisiere auf mindestens `Node 22.13.x`, weil React Native 0.85 dafuer weniger Engine-Warnungen zeigt.
3. Installiere Abhaengigkeiten:

```powershell
npm.cmd install
```

4. Starte das Projekt:

```powershell
npm.cmd run android
```

Alternativ:

```powershell
npm.cmd start
```

Dann kannst du die App in `Expo Go` auf Android oeffnen oder einen Emulator verwenden.

### Anklickbare Dateien

- `Start-KontrolRadar-PC.cmd`
  Startet den Prototyp als Web-Version direkt auf dem PC.
- `Build-KontrolRadar.cmd`
  Oeffnet einen Build-Assistenten mit Fragen zu Version, Plattform und Build-Art.

Der Build-Assistent kann:

- einen lokalen Web-Build nach `builds\web\...` exportieren
- einen GitHub-Pages-Build nach `docs\` exportieren
- einen Android Preview Build als `APK` ueber `EAS`
- einen Android Production Build als `AAB` ueber `EAS`
- einen iOS Preview oder Production Build ueber `EAS`

## Projektstruktur

- `App.tsx`: Hauptoberflaeche mit Tabs, Karte, Onboarding und Meldedialog
- `src/components/TransitMap.web.tsx`: Web-Karte mit `MapLibre GL` und `OpenFreeMap`
- `src/components/TransitMap.native.tsx`: Mobile OpenFreeMap-Einbettung fuer den Expo-Prototyp
- `src/data/mock.ts`: Demo-Haltestellen und Startmeldungen
- `src/lib/alerts.ts`: Sortier- und Priorisierungslogik
- `src/types.ts`: Gemeinsame TypeScript-Typen

## Naechste sinnvolle Schritte

1. GTFS- oder Open-Data-Feeds des Verkehrsbetriebs anbinden, damit Haltestellen und Linien echt werden.
2. Backend mit `Supabase` oder `Firebase` aufsetzen, damit Meldungen zwischen Geraeten geteilt werden.
3. Push-Benachrichtigungen fuer favorisierte Linien und Haltestellen aktivieren.
4. Moderation und Rate-Limits einbauen, um Spam und missbraeuchliche Inhalte zu begrenzen.
5. Spater iOS-Builds ueber Expo/EAS oder Xcode ergaenzen.
