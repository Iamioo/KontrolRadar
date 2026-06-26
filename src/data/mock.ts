import type { Stop } from '../types';

export const DEFAULT_REGION = {
  latitude: 52.52035,
  latitudeDelta: 0.03,
  longitude: 13.4095,
  longitudeDelta: 0.03,
};

export const SAMPLE_STOPS: Stop[] = [
  {
    id: 'stop-alexanderplatz',
    latitude: 52.52188,
    lines: ['100', '200', 'M48'],
    longitude: 13.41321,
    name: 'Alexanderplatz',
    neighborhood: 'Berlin-Mitte',
  },
  {
    id: 'stop-spandauer-strasse',
    latitude: 52.51978,
    lines: ['100', '200', '300'],
    longitude: 13.40682,
    name: 'Spandauer Strasse / Marienkirche',
    neighborhood: 'Berlin-Mitte',
  },
  {
    id: 'stop-hackescher-markt',
    latitude: 52.52337,
    lines: ['M1', 'M4', 'N8'],
    longitude: 13.40271,
    name: 'Hackescher Markt',
    neighborhood: 'Berlin-Mitte',
  },
  {
    id: 'stop-rotes-rathaus',
    latitude: 52.51889,
    lines: ['200', '248', '300'],
    longitude: 13.4087,
    name: 'Rotes Rathaus',
    neighborhood: 'Berlin-Mitte',
  },
  {
    id: 'stop-museumsinsel',
    latitude: 52.51725,
    lines: ['100', '300'],
    longitude: 13.40098,
    name: 'Museumsinsel',
    neighborhood: 'Berlin-Mitte',
  },
  {
    id: 'stop-potsdamer-platz',
    latitude: 52.50964,
    lines: ['M41', 'M48', 'M85'],
    longitude: 13.37604,
    name: 'Potsdamer Platz / Vossstrasse',
    neighborhood: 'Tiergarten',
  },
  {
    id: 'stop-zoo',
    latitude: 52.50794,
    lines: ['100', '200', 'M45'],
    longitude: 13.33776,
    name: 'Zoologischer Garten',
    neighborhood: 'Charlottenburg',
  },
  {
    id: 'stop-unter-den-linden',
    latitude: 52.51672,
    lines: ['100', '147', '300'],
    longitude: 13.38886,
    name: 'Unter den Linden / Friedrichstrasse',
    neighborhood: 'Berlin-Mitte',
  },
];

export const LINE_OPTIONS = [...new Set(SAMPLE_STOPS.flatMap((stop) => stop.lines))].sort(
  (left, right) => left.localeCompare(right),
);
