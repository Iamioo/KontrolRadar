import type { Alert } from '../types';

const CHANNEL_NAME = 'kontrolradar-alert-mesh';
const STORAGE_EVENT_KEY = 'kontrolradar/peer-alert';

type PeerAlertMessage = {
  alert: Alert;
  nonce: string;
  originId: string;
  type: 'alert';
};

let cachedPeerId: string | null = null;

function isBrowser() {
  return typeof window !== 'undefined';
}

function createPeerId() {
  if (cachedPeerId) {
    return cachedPeerId;
  }

  cachedPeerId =
    globalThis.crypto?.randomUUID?.() ??
    `peer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return cachedPeerId;
}

export function getLocalPeerId() {
  return createPeerId();
}

function isPeerAlertMessage(value: unknown): value is PeerAlertMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PeerAlertMessage>;

  return candidate.type === 'alert' && typeof candidate.originId === 'string' && !!candidate.alert;
}

function createMessage(alert: Alert): PeerAlertMessage {
  return {
    alert,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    originId: createPeerId(),
    type: 'alert',
  };
}

export function publishPeerAlert(alert: Alert) {
  if (!isBrowser()) {
    return;
  }

  const message = createMessage(alert);

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  }

  try {
    window.localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(message));
    window.localStorage.removeItem(STORAGE_EVENT_KEY);
  } catch {
    return;
  }
}

export function subscribeToPeerAlerts(onAlert: (alert: Alert) => void) {
  if (!isBrowser()) {
    return () => undefined;
  }

  const peerId = createPeerId();
  let channel: BroadcastChannel | null = null;

  const handleMessage = (message: unknown) => {
    if (!isPeerAlertMessage(message) || message.originId === peerId) {
      return;
    }

    onAlert(message.alert);
  };

  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => handleMessage(event.data));
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_EVENT_KEY || !event.newValue) {
      return;
    }

    try {
      handleMessage(JSON.parse(event.newValue));
    } catch {
      return;
    }
  };

  window.addEventListener('storage', handleStorage);

  return () => {
    channel?.close();
    window.removeEventListener('storage', handleStorage);
  };
}
