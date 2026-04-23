const STORAGE_KEY = "fleet_driver_outbox_v1";

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowMs() {
  return Date.now();
}

function generateId() {
  return `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readDriverOutbox() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = safeJsonParse(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function writeDriverOutbox(items) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(items) ? items : []));
  } catch {
    // ignore (quota / privacy mode)
  }
}

export function enqueueDriverOutboxItem({ type, payload }) {
  const id = generateId();
  const createdAt = new Date().toISOString();
  const item = {
    id,
    type: String(type || "").trim(),
    payload: payload ?? null,
    createdAt,
    retryCount: 0,
    nextAttemptAt: nowMs(),
    lastError: "",
  };

  const list = readDriverOutbox();
  writeDriverOutbox([item, ...list].slice(0, 200));
  return item;
}

export function removeDriverOutboxItem(id) {
  const list = readDriverOutbox();
  const next = list.filter((it) => String(it?.id) !== String(id));
  writeDriverOutbox(next);
  return next;
}

export function markDriverOutboxItemFailed(id, errorMessage) {
  const list = readDriverOutbox();
  const next = list.map((it) => {
    if (String(it?.id) !== String(id)) return it;
    const retryCount = Math.max(0, Number(it.retryCount || 0)) + 1;
    const base = 4000;
    const max = 5 * 60 * 1000;
    const delay = Math.min(max, base * Math.pow(2, Math.min(8, retryCount)));
    const jitter = Math.floor(Math.random() * 800);
    return {
      ...it,
      retryCount,
      nextAttemptAt: nowMs() + delay + jitter,
      lastError: String(errorMessage || "").slice(0, 280),
    };
  });
  writeDriverOutbox(next);
  return next;
}

export function getDueDriverOutboxItems({ limit = 5 } = {}) {
  const list = readDriverOutbox();
  const t = nowMs();
  const due = list
    .filter((it) => it && typeof it === "object")
    .filter((it) => {
      const nextAt = Number(it.nextAttemptAt ?? 0);
      return Number.isFinite(nextAt) ? nextAt <= t : true;
    })
    .slice(0, Math.max(1, Number(limit || 5)));
  return due;
}

export function clearDriverOutbox() {
  writeDriverOutbox([]);
}

export function driverOutboxCount() {
  return readDriverOutbox().length;
}

