import { getValue, setValue } from './db.js';

const STATE_KEY = 'travel-state-v1';
const uid = (prefix = 'id') => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const DEFAULT_TRIP_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function defaultState() {
  const start = new Date();
  start.setDate(start.getDate() + 14);
  const startDate = start.toISOString().slice(0,10);
  const end = new Date(start); end.setDate(end.getDate() + 4);
  const endDate = end.toISOString().slice(0,10);
  return {
    version: 1,
    revision: 0,
    trip: { id: 'local', title: '나트랑 가족여행', city: 'Nha Trang', country: 'Vietnam', startDate, endDate, lat: 12.2388, lng: 109.1967, timeZone: DEFAULT_TRIP_TIME_ZONE },
    days: buildDays(startDate, endDate),
    favorites: [],
    expenses: [],
    checklist: [
      { id: uid('check'), title: '여권', done: false },
      { id: uid('check'), title: '여행자보험', done: false },
      { id: uid('check'), title: 'eSIM 또는 로밍', done: false },
      { id: uid('check'), title: '숙소 예약 확인', done: false },
      { id: uid('check'), title: '보조배터리', done: false }
    ],
    documents: [],
    members: [{ id: 'local-owner', name: '제작자', role: 'OWNER' }],
    exchange: { rate: 0.0523, day: '', source: 'offline-default' },
    settings: { theme: 'warm-ivory', accent: 'sand', activeDayId: null, moneyDisplay: 'compact' },
    updatedAt: new Date().toISOString()
  };
}

export function buildDays(startDate, endDate, existing = []) {
  const out = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return existing;
  let cursor = new Date(start), i = 1;
  while (cursor <= end && i <= 60) {
    const date = localDateKey(cursor);
    const prev = existing.find(d => d.date === date);
    out.push(prev || { id: uid('day'), date, items: [] });
    cursor.setDate(cursor.getDate() + 1); i += 1;
  }
  return out;
}

export function normalizeState(state) {
  state.trip ||= {};
  state.trip.timeZone ||= DEFAULT_TRIP_TIME_ZONE;
  state.days ||= [];
  state.favorites ||= [];
  state.expenses ||= [];
  state.checklist ||= [];
  state.documents ||= [];
  state.members ||= [];
  state.exchange ||= { rate: 0.0523, day: '', source: 'offline-default' };
  state.settings ||= { theme: 'warm-ivory', accent: 'sand', activeDayId: null, moneyDisplay: 'compact' };
  state.settings.moneyDisplay ||= 'compact';
  if (!['compact','detail'].includes(state.settings.moneyDisplay)) state.settings.moneyDisplay = 'compact';
  const expectedDays = buildDays(state.trip.startDate, state.trip.endDate);
  if (state.days.length === expectedDays.length && state.days[0]?.date !== expectedDays[0]?.date) {
    state.days = expectedDays.map((day, index) => ({ ...state.days[index], date: day.date }));
  } else {
    state.days = buildDays(state.trip.startDate, state.trip.endDate, state.days);
  }
  if (!state.settings.activeDayId) state.settings.activeDayId = state.days[0]?.id || null;
  return state;
}

export async function loadState() {
  const saved = await getValue(STATE_KEY).catch(() => null);
  return normalizeState(saved || defaultState());
}

export async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  await setValue(STATE_KEY, state);
}

export { uid };
