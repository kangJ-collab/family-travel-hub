const CONFIG_KEY = 'fth.config';
const DEFAULT_WORKER_URL = 'https://family-travel-hub-api.efde234.workers.dev';

export function getConfig() {
  try { return { workerUrl: DEFAULT_WORKER_URL, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') }; }
  catch { return { workerUrl: DEFAULT_WORKER_URL }; }
}
export function setConfig(next) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...getConfig(), ...next }));
}
export function isWorkerConfigured() {
  return Boolean(getConfig().workerUrl);
}

async function request(path, options = {}, auth = false) {
  const cfg = getConfig();
  if (!cfg.workerUrl) throw new Error('Cloudflare Worker 주소가 설정되지 않았습니다.');
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (auth && cfg.deviceToken) headers.set('Authorization', `Bearer ${cfg.deviceToken}`);
  const res = await fetch(`${cfg.workerUrl.replace(/\/$/, '')}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  createTrip: (payload, ownerKey) => request('/api/trips/create', { method: 'POST', headers: { 'X-Owner-Key': ownerKey }, body: JSON.stringify(payload) }),
  joinInvite: (payload) => request('/api/invites/join', { method: 'POST', body: JSON.stringify(payload) }),
  getTrip: () => request('/api/trip', {}, true),
  putTrip: (payload) => request('/api/trip', { method: 'PUT', body: JSON.stringify(payload) }, true),
  getMembers: () => request('/api/members', {}, true),
  invite: (role = 'EDITOR') => request('/api/invites/create', { method: 'POST', body: JSON.stringify({ role }) }, true),
  setRole: (memberId, role) => request(`/api/members/${encodeURIComponent(memberId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }, true),
  searchPlaces: (query) => request(`/api/places/search?q=${encodeURIComponent(query)}`, {}, true),
  route: (origin, destination, mode) => request('/api/routes', { method: 'POST', body: JSON.stringify({ origin, destination, mode }) }, true),
  optimize: (payload) => request('/api/routes/optimize', { method: 'POST', body: JSON.stringify(payload) }, true),
  exchange: () => request('/api/exchange', {}, true),
  weather: (lat, lng) => request(`/api/weather?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, {}, true),
  shareLocation: (lat, lng) => request('/api/location/share', { method: 'POST', body: JSON.stringify({ lat, lng }) }, true),
  getLocations: () => request('/api/locations', {}, true)
};
