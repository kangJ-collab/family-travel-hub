import { loadState, saveState, buildDays, normalizeState, uid } from './state.js';
import { api, getConfig, setConfig } from './api.js';

let state;
let activeView = 'home';
let sheetCleanup = null;
let pendingExternalUrl = null;
let currentPosition = null;
let gpsWatchId = null;
let lastLiveRouteAt = 0;
let sharedLocations = [];
let saveTimer = null;
let syncTimer = null;
let pageScrollY = 0;
let pageScrollStyles = null;
let sheetDismissTimer = null;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const icon = (name) => `<i data-lucide="${name}"></i>`;
const nativeDateInput = ({ id = '', name, type = 'date', value = '', required = false }) => `<span class="native-date-control"><input ${id ? `id="${esc(id)}"` : ''} name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></span>`;

function createIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = message;
  $('#toastRegion').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function scheduleSave({ sync = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveState(state);
    if (sync) scheduleSync();
  }, 120);
}
function scheduleSync() {
  const cfg = getConfig();
  if (!cfg.deviceToken) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushSync().catch(() => {}), 1200);
}

function formatDate(dateStr, opts = {}) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: opts.weekday ? 'short' : undefined }).format(d);
}
function dateKeyInZone(timeZone = state?.trip?.timeZone || 'Asia/Ho_Chi_Minh', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function clockMinutesInZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return value.hour * 60 + value.minute;
}
function clockText(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
function clockDateText(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}
function dayNumber(day) { return state.days.findIndex(d => d.id === day.id) + 1; }
function activeDay() { return state.days.find(d => d.id === state.settings.activeDayId) || state.days[0]; }
function getTodayTripDay() {
  const today = dateKeyInZone();
  return state.days.find(d => d.date === today) || activeDay();
}
function fmtTime(time) { return time || '시간 미지정'; }
function minutesText(sec) { return Number.isFinite(sec) ? `${Math.max(1, Math.round(sec / 60))}분` : '--'; }
function money(n) { return `${Math.round(Number(n || 0)).toLocaleString('ko-KR')}원`; }
function rawDigits(v) { return String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/,''); }
function formatNumberInput(v) { const d = rawDigits(v); return d ? Number(d).toLocaleString('en-US') : ''; }
function formatVndKorean(value) {
  const n = Math.floor(Number(value || 0));
  if (!n) return '0 동';
  if (n >= 100000000) {
    const eok = Math.floor(n / 100000000), rest = n % 100000000;
    return `${eok}억${rest ? ` ${Math.floor(rest / 10000)}만` : ''} 동`;
  }
  if (n >= 10000) {
    const man = Math.floor(n / 10000), rest = n % 10000;
    return `${man}만${rest ? ` ${rest.toLocaleString('ko-KR')}` : ''} 동`;
  }
  if (n >= 1000) return `${Math.floor(n / 1000)}천${n % 1000 ? ` ${n % 1000}` : ''} 동`;
  return `${n.toLocaleString('ko-KR')} 동`;
}

function applyTheme() {
  const { theme = 'warm-ivory', accent = 'sand' } = state.settings;
  document.documentElement.dataset.theme = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.accent = accent;
  const themeMeta = $('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f4efe4';
}

function renderAll() {
  applyTheme(); renderHeader(); renderClocks(); renderHome(); renderPlan(); renderSaved(); renderTools(); updateNav(); createIcons();
}
function renderHeader() {
  $('#tripTitle').textContent = state.trip.title;
  $('#tripRange').textContent = `${formatDate(state.trip.startDate)} - ${formatDate(state.trip.endDate)}`;
  $('#tripEyebrow').textContent = `${state.trip.city.toUpperCase()} · ${state.trip.country.toUpperCase()}`;
}
function renderClocks() {
  const now = new Date();
  const tripZone = state.trip.timeZone || 'Asia/Ho_Chi_Minh';
  const city = state.trip.city === 'Nha Trang' ? '나트랑' : state.trip.city;
  $('#tripClockLabel').textContent = `${city} · 현지`;
  $('#tripClock').textContent = clockText(tripZone, now);
  $('#tripClockDate').textContent = `${clockDateText(tripZone, now)} · GMT+7`;
  $('#koreaClock').textContent = clockText('Asia/Seoul', now);
  $('#koreaClockDate').textContent = `${clockDateText('Asia/Seoul', now)} · GMT+9`;
}
function renderHome() {
  const day = getTodayTripDay();
  const items = day?.items || [];
  $('#homeDayLabel').textContent = day ? `DAY ${dayNumber(day)} · ${formatDate(day.date, { weekday: true })}` : 'TODAY';
  $('#todayDateLabel').textContent = day ? `DAY ${dayNumber(day)}` : 'TODAY';
  $('#todaySummary').textContent = items.length ? `${items.length}개의 일정이 있습니다` : '일정을 추가해보세요';
  $('#syncBadge').textContent = getConfig().deviceToken ? '가족 공유' : '로컬';
  const timeline = $('#todayTimeline');
  timeline.innerHTML = items.length ? items.slice(0,6).map((item, idx) => `
    <div class="timeline-item">
      <div class="timeline-time">${esc(fmtTime(item.time))}</div>
      <div><div class="timeline-name">${esc(item.name)}</div>
      ${idx < items.length - 1 ? `<div class="timeline-route"><span>${icon('car-front')}${esc(item.routeToNext?.driveText || '--')}</span><span>${icon('footprints')}${esc(item.routeToNext?.walkText || '--')}</span></div>` : ''}</div>
    </div>`).join('') : '<div class="empty-state">일정 탭에서 첫 장소를 추가하세요.</div>';

  const next = findNextItem(day);
  $('#nextStopName').textContent = next?.name || '다음 일정 없음';
  $('#openNextMapBtn span').textContent = next ? 'Google Maps에서 보기' : `${state.trip.city || '여행지'} 지도 열기`;
  const route = next ? routeForNext(day, next) : null;
  const chips = $$('#nextRouteInfo .route-chip strong');
  chips[0].textContent = route?.driveText || '--'; chips[1].textContent = route?.walkText || '--';
  $('#nextRouteInfo').classList.toggle('is-empty', !route);
  $('#todaySpend').textContent = money(todayExpenses(day?.date));
}
function findNextItem(day) {
  if (!day?.items?.length) return null;
  const now = new Date();
  const tripZone = state.trip.timeZone || 'Asia/Ho_Chi_Minh';
  if (day.date !== dateKeyInZone(tripZone, now)) return day.items[0];
  const mins = clockMinutesInZone(tripZone, now);
  return day.items.find(i => { if (!i.time) return false; const [h,m] = i.time.split(':').map(Number); return h*60+m >= mins; }) || day.items.find(i => !i.time) || day.items.at(-1);
}
function routeForNext(day, item) {
  const idx = day.items.findIndex(i => i.id === item.id);
  if (idx <= 0) return item.routeFromCurrent || null;
  return day.items[idx-1]?.routeToNext || null;
}
function todayExpenses(date) { return state.expenses.filter(e => e.date === date).reduce((s,e) => s + Number(e.krw || 0), 0); }

function renderPlan() {
  const tabs = $('#dayTabs');
  tabs.innerHTML = state.days.map((d,i) => `<button class="day-tab ${d.id === activeDay()?.id ? 'is-active' : ''}" data-day-id="${d.id}" role="tab" type="button"><span>DAY ${i+1}</span><span class="day-tab__date">${formatDate(d.date)}</span></button>`).join('');
  const day = activeDay();
  const list = $('#planList');
  if (!day?.items?.length) {
    list.innerHTML = '<div class="empty-state">이 날짜에는 아직 일정이 없습니다.<br>상단의 추가 버튼으로 장소를 넣어보세요.</div>';
    return;
  }
  list.innerHTML = day.items.map((item, idx) => `
    <div>
      <article class="plan-item" data-item-id="${item.id}">
        <div class="plan-item__index">${idx+1}</div>
        <div class="plan-item__main">
          <h3 class="plan-item__name">${esc(item.name)}</h3>
          <div class="plan-item__meta">
            <span>${icon('clock-3')}${esc(fmtTime(item.time))}</span>
            ${item.locked ? `<span>${icon('lock')}잠금</span>` : ''}
            ${item.category ? `<span>${icon(categoryIcon(item.category))}${esc(item.category)}</span>` : ''}
          </div>
        </div>
        <div class="plan-item__actions">
          <button data-action="up" aria-label="위로 이동" ${idx===0?'disabled':''}>${icon('chevron-up')}</button>
          <button data-action="edit" aria-label="일정 편집">${icon('pencil')}</button>
        </div>
      </article>
      ${idx < day.items.length-1 ? `<div class="route-between"><span>${icon('car-front')}${esc(item.routeToNext?.driveText || '차량 --')}</span><span>${icon('footprints')}${esc(item.routeToNext?.walkText || '도보 --')}</span></div>` : ''}
    </div>`).join('');
}
function categoryIcon(category) {
  return ({'호텔':'hotel','카페':'coffee','식당':'utensils','관광':'landmark','마사지':'sparkles','쇼핑':'shopping-bag','공항':'plane','기타':'map-pin'})[category] || 'map-pin';
}

function renderSaved() {
  $('#favoriteCount').textContent = String(state.favorites.length);
  const el = $('#favoritesList');
  el.innerHTML = state.favorites.length ? state.favorites.map(f => `
    <article class="result-card" data-fav-id="${f.id}">
      <div class="result-card__top"><div><h4>${esc(f.name)}</h4><p>${esc(f.category || '저장한 장소')}</p></div>${icon(categoryIcon(f.category))}</div>
      <div class="card-actions">
        <button class="secondary-btn" data-action="add-plan">${icon('calendar-plus')}일정에 추가</button>
        <button class="secondary-btn" data-action="map">${icon('map')}지도</button>
        <button class="danger-btn" data-action="remove">${icon('trash-2')}삭제</button>
      </div>
    </article>`).join('') : '<div class="empty-state">검색한 장소를 저장해두면 여행 일정에 바로 추가할 수 있습니다.</div>';
}

function renderTools() {
  renderQuickAmounts(); renderExpenses(); renderChecklist(); renderDocuments(); renderExternalTools(); renderMembers(); renderFamilyLocations(); updateCurrency();
}
function renderQuickAmounts() {
  const vals = [10000,50000,100000,200000,500000,1000000];
  $('#quickAmounts').innerHTML = vals.map(v => `<button type="button" class="quick-amount" data-vnd="${v}">${formatVndKorean(v).replace(' 동','')}</button>`).join('');
}
function renderExpenses() {
  $('#tripSpendTotal').textContent = money(state.expenses.reduce((s,e)=>s+Number(e.krw||0),0));
  const el = $('#expenseList');
  el.innerHTML = state.expenses.length ? state.expenses.slice().reverse().slice(0,12).map(e => `<div class="simple-row" data-expense-id="${e.id}"><div><h4>${esc(e.title || e.category || '지출')}</h4><small class="muted">${esc(formatDate(e.date))} · ${Number(e.vnd).toLocaleString()} VND</small></div><strong>${money(e.krw)}</strong></div>`).join('') : '<div class="empty-state">환율 계산 후 바로 지출로 기록할 수 있습니다.</div>';
}
function renderChecklist() {
  $('#checklist').innerHTML = state.checklist.map(c => { const inputId=`check-${c.id}`; return `<div class="check-row" data-check-id="${esc(c.id)}"><input id="${esc(inputId)}" type="checkbox" ${c.done?'checked':''} aria-label="${esc(c.title)} 완료"><label for="${esc(inputId)}" class="${c.done?'is-done':''}">${esc(c.title)}</label><button class="check-delete-btn" data-action="remove" aria-label="${esc(c.title)} 삭제">${icon('trash-2')}</button></div>`; }).join('');
}
function renderDocuments() {
  $('#documentsList').innerHTML = state.documents.length ? state.documents.map(d => `<div class="simple-row" data-doc-id="${d.id}"><div><h4>${esc(d.title)}</h4><small class="muted">${esc(d.type || '기타')} ${d.date ? `· ${formatDate(d.date)}`:''}</small></div>${d.url ? `<button class="icon-btn icon-btn--small" data-action="open" aria-label="열기">${icon('external-link')}</button>`:''}</div>`).join('') : '<div class="empty-state">항공, 숙소, 보험, eSIM 등의 예약 정보를 한곳에 보관하세요.</div>';
}
function renderExternalTools() {
  const tools = [
    ['Google Maps','지도 · 길찾기','map','https://www.google.com/maps'],
    ['Papago','번역','languages','https://papago.naver.com/'],
    ['Google Translate','번역','languages','https://translate.google.com/'],
    ['Grab','차량 · 배달','car-front','https://www.grab.com/vn/'],
    ['Windy','바람 · 기상','wind','https://www.windy.com/'],
    ['LOTTE Mart Vietnam','장보기','shopping-cart','https://www.lottemart.vn/'],
    ['해외안전여행','공식 안전정보','shield-check','https://www.0404.go.kr/'],
    ['USGS Earthquakes','최근 지진','activity','https://earthquake.usgs.gov/earthquakes/map/']
  ];
  $('#externalTools').innerHTML = tools.map(([name,desc,ic,url]) => `<button class="tool-link" type="button" data-url="${url}" data-name="${name}">${icon(ic)}<span>${name}</span><small>${desc}</small></button>`).join('');
}
function renderMembers() {
  const cfg = getConfig();
  $('#membersList').innerHTML = state.members.map(m => {
    const canRename = cfg.role === 'OWNER' || m.id === cfg.memberId || (!cfg.deviceToken && m.role === 'OWNER');
    const canChangeRole = cfg.role === 'OWNER' && m.role !== 'OWNER';
    const actions = `${canRename ? `<button class="secondary-btn" data-action="name">${icon('pencil')}이름</button>` : ''}${canChangeRole ? `<button class="secondary-btn" data-action="role">권한 변경</button>` : ''}`;
    return `<div class="simple-row" data-member-id="${esc(m.id)}"><div><h4>${esc(m.name)}</h4><small class="muted">${esc(m.role)}</small></div>${actions ? `<div class="member-actions">${actions}</div>` : ''}</div>`;
  }).join('');
}
function renderFamilyLocations() {
  const el = $('#familyLocations');
  if (!el) return;
  el.innerHTML = sharedLocations.length ? sharedLocations.map(loc => {
    const ageMin = Math.max(0, Math.round((Date.now() - new Date(loc.sharedAt).getTime()) / 60000));
    const age = ageMin < 1 ? '방금 전' : ageMin < 60 ? `${ageMin}분 전` : `${Math.floor(ageMin/60)}시간 전`;
    return `<div class="simple-row" data-lat="${loc.lat}" data-lng="${loc.lng}"><div><h4>${esc(loc.name)}</h4><small class="muted">${age} 공유</small></div><button class="secondary-btn" data-action="location-map">지도에서 보기</button></div>`;
  }).join('') : '<div class="empty-state">가족이 직접 공유한 현재 위치만 표시합니다. 상시 추적하지 않습니다.</div>';
}
function updateCurrency() {
  const input = $('#vndInput');
  const n = Number(rawDigits(input.value));
  $('#vndKoreanLabel').textContent = formatVndKorean(n);
  $('#krwResult').textContent = money(n * Number(state.exchange.rate || 0));
  $('#rateMeta').textContent = state.exchange.day ? `${state.exchange.day} 기준 · 1 VND = ${Number(state.exchange.rate).toFixed(4)} KRW` : `오프라인 기준값 · 1 VND = ${Number(state.exchange.rate).toFixed(4)} KRW`;
}

function updateNav() {
  $$('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === activeView));
  $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.nav === activeView));
}
function go(view) { activeView = view; updateNav(); window.scrollTo({ top: 0, behavior: 'instant' }); }

function lockPageScroll() {
  if (pageScrollStyles) return;
  pageScrollY = window.scrollY;
  pageScrollStyles = {
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
    width: document.body.style.width,
    overflow: document.body.style.overflow
  };
  Object.assign(document.body.style, {
    position: 'fixed',
    top: `-${pageScrollY}px`,
    left: '0',
    right: '0',
    width: '100%',
    overflow: 'hidden'
  });
}

function unlockPageScroll() {
  if (!pageScrollStyles) return;
  Object.assign(document.body.style, pageScrollStyles);
  pageScrollStyles = null;
  window.scrollTo(0, pageScrollY);
}

function openSheet(title, eyebrow, html, setup) {
  clearTimeout(sheetDismissTimer);
  if (sheetCleanup) sheetCleanup();
  $('#sheetTitle').textContent = title; $('#sheetEyebrow').textContent = eyebrow;
  $('#sheetBody').innerHTML = html;
  const sheet = $('#bottomSheet');
  const backdrop = $('#sheetBackdrop');
  backdrop.classList.remove('is-dismissing');
  sheet.classList.remove('is-dragging');
  sheet.style.setProperty('--sheet-drag-y', '0px');
  backdrop.hidden = false; sheet.hidden = false;
  sheet.scrollTop = 0;
  $('#sheetBody').scrollTop = 0;
  lockPageScroll();
  createIcons(); sheetCleanup = setup?.() || null;
}
function closeSheet() {
  clearTimeout(sheetDismissTimer);
  const sheet = $('#bottomSheet');
  $('#sheetBackdrop').hidden = true; sheet.hidden = true;
  $('#sheetBackdrop').classList.remove('is-dismissing');
  sheet.classList.remove('is-dragging');
  sheet.style.setProperty('--sheet-drag-y', '0px');
  unlockPageScroll();
  if (sheetCleanup) sheetCleanup(); sheetCleanup = null;
}

function dismissSheetFromDrag() {
  const sheet = $('#bottomSheet');
  sheet.classList.remove('is-dragging');
  sheet.style.setProperty('--sheet-drag-y', `${sheet.offsetHeight + 32}px`);
  $('#sheetBackdrop').classList.add('is-dismissing');
  clearTimeout(sheetDismissTimer);
  sheetDismissTimer = setTimeout(closeSheet, 220);
}
function confirmExternal(name, url, message) {
  pendingExternalUrl = url;
  $('#modalTitle').textContent = `${name}로 이동합니다`;
  $('#modalMessage').textContent = message || '현재 웹앱을 벗어나 외부 앱 또는 웹사이트가 열립니다.';
  $('#modalBackdrop').hidden = false; $('#confirmModal').hidden = false; createIcons();
}
function closeModal() { $('#modalBackdrop').hidden = true; $('#confirmModal').hidden = true; pendingExternalUrl = null; }

function openPlanEditor(item = null, prefill = {}) {
  const day = activeDay(); const data = item || { name: prefill.name || '', time: '', category: prefill.category || '기타', locked: false, placeId: prefill.placeId || '', note: '' };
  openSheet(item ? '일정 편집' : '일정 추가', `DAY ${dayNumber(day)} · ${formatDate(day.date)}`, `
    <form id="planEditForm" class="form-grid">
      <div class="form-field"><label for="planName">장소 또는 일정명</label><input id="planName" name="name" value="${esc(data.name)}" required placeholder="포나가르 사원"></div>
      <div class="form-grid two">
        <div class="form-field"><label for="planDate">날짜</label>${nativeDateInput({ id:'planDate', name:'date', value:day.date, required:true })}</div>
        <div class="form-field"><label for="planTime">시간 · 선택사항</label>${nativeDateInput({ id:'planTime', name:'time', type:'time', value:data.time || '' })}</div>
      </div>
      <div class="form-field"><label for="planCategory">종류</label><select id="planCategory" name="category">${['호텔','카페','식당','관광','마사지','쇼핑','공항','기타'].map(c=>`<option ${c===data.category?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-field"><label for="planPlaceId">Google Place ID · 선택사항</label><input id="planPlaceId" name="placeId" value="${esc(data.placeId || '')}" placeholder="Places 검색으로 자동 입력"></div>
      <div class="form-field"><label for="planNote">메모</label><textarea id="planNote" name="note" placeholder="예약번호, 주문할 메뉴 등">${esc(data.note || '')}</textarea></div>
      <label class="switch-row"><span>동선 추천에서 위치 잠금</span><input type="checkbox" name="locked" ${data.locked?'checked':''}></label>
      <div class="sheet-actions"><button class="secondary-btn" type="button" data-sheet-cancel>취소</button><button class="primary-btn" type="submit">저장</button></div>
      ${item ? '<button id="deletePlanItem" class="danger-btn" type="button">일정 삭제</button>' : ''}
    </form>`, () => {
      const form = $('#planEditForm');
      const submit = (e) => {
        e.preventDefault(); const fd = new FormData(form); const targetDay = state.days.find(d => d.date === fd.get('date')) || day;
        const payload = { ...(item || {}), id: item?.id || uid('plan'), name: String(fd.get('name')).trim(), time: String(fd.get('time')||''), category: String(fd.get('category')), placeId: String(fd.get('placeId')||'').trim(), note: String(fd.get('note')||''), locked: fd.get('locked') === 'on', updatedAt: new Date().toISOString() };
        if (item) state.days.forEach(d => d.items = d.items.filter(x => x.id !== item.id));
        targetDay.items.push(payload); state.settings.activeDayId = targetDay.id;
        sortByTimeStable(targetDay.items); scheduleSave(); closeSheet(); renderAll(); toast('일정을 저장했습니다.');
      };
      form.addEventListener('submit', submit);
      $('[data-sheet-cancel]', form).onclick = closeSheet;
      if (item) $('#deletePlanItem').onclick = () => { day.items = day.items.filter(x => x.id !== item.id); scheduleSave(); closeSheet(); renderAll(); toast('일정을 삭제했습니다.'); };
      return () => form.removeEventListener('submit', submit);
    });
}
function sortByTimeStable(items) {
  items.sort((a,b) => {
    if (!a.time && !b.time) return 0; if (!a.time) return 1; if (!b.time) return -1; return a.time.localeCompare(b.time);
  });
}

function openSettings() {
  const cfg = getConfig();
  const roleLabel = ({ OWNER:'OWNER · 관리자', EDITOR:'EDITOR · 일정 편집', VIEWER:'VIEWER · 보기 전용' })[cfg.role] || '가족 구성원';
  openSheet('설정', 'APP & TRIP', `
    <form id="settingsForm" class="form-grid">
      <div class="form-field"><label>여행 이름</label><input name="title" value="${esc(state.trip.title)}"></div>
      <div class="form-grid two"><div class="form-field"><label>여행 시작일</label>${nativeDateInput({ name:'startDate', value:state.trip.startDate })}</div><div class="form-field"><label>여행 종료일</label>${nativeDateInput({ name:'endDate', value:state.trip.endDate })}</div></div>
      <div class="form-grid two"><div class="form-field"><label>테마</label><select name="theme">${[['system','시스템'],['light','라이트'],['dark','다크'],['ivory','아이보리'],['warm-ivory','웜 아이보리']].map(([v,l])=>`<option value="${v}" ${state.settings.theme===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="form-field"><label>강조 색상</label><select name="accent">${[['blue','Blue'],['green','Green'],['sand','Sand'],['coral','Coral'],['purple','Purple']].map(([v,l])=>`<option value="${v}" ${state.settings.accent===v?'selected':''}>${l}</option>`).join('')}</select></div></div>
      <div class="auth-card">${icon(cfg.deviceToken ? 'shield-check' : 'shield')}<div><strong>${cfg.deviceToken ? `가족 인증 연결됨 · ${roleLabel}` : '가족 인증 연결 전'}</strong><p>${cfg.deviceToken ? '이 기기의 인증 토큰이 API 요청에 자동으로 사용됩니다. 직접 입력하거나 복사할 필요가 없습니다. 브라우저 데이터를 삭제하면 새 초대가 필요합니다.' : 'OWNER 설정키로 가족 공유를 시작하면 이 기기 전용 인증 토큰이 자동 발급·저장됩니다.'}</p></div></div>
      ${cfg.deviceToken ? '' : '<div class="form-field"><label>OWNER 설정키</label><input type="password" name="ownerKey" autocomplete="off" placeholder="Cloudflare에 등록한 설정키 입력"><p class="helper-text">Cloudflare Worker Secret에 등록한 값과 똑같이 입력하세요. 가족 초대 링크에는 포함되지 않습니다.</p></div>'}
      <p class="helper-text">Google Places/Routes API 키와 OWNER 설정키는 프런트엔드 소스에 저장하지 않습니다.</p>
      <p id="settingsError" class="form-error" role="alert"></p>
      <div class="sheet-actions"><button class="secondary-btn" type="button" data-sheet-cancel>취소</button><button id="saveSettingsBtn" class="primary-btn" type="submit">${cfg.deviceToken ? '설정 저장' : '저장 및 가족 연결'}</button></div>
    </form>`, () => {
      const form = $('#settingsForm');
      form.onsubmit = async (e) => {
        e.preventDefault(); const fd = new FormData(form); const startDate=String(fd.get('startDate')), endDate=String(fd.get('endDate'));
        const errorEl = $('#settingsError'); const submitBtn = $('#saveSettingsBtn'); const ownerKey = String(fd.get('ownerKey')||'').trim();
        errorEl.textContent='';
        if (!cfg.deviceToken && !ownerKey) { errorEl.textContent='OWNER 설정키를 입력하면 설정 저장과 가족 연결이 함께 진행됩니다.'; return; }
        state.trip.title = String(fd.get('title')||'').trim() || '가족여행'; state.trip.startDate=startDate; state.trip.endDate=endDate;
        state.days = buildDays(startDate,endDate,state.days); state.settings.activeDayId = state.days.find(d=>d.id===state.settings.activeDayId)?.id || state.days[0]?.id;
        state.settings.theme=String(fd.get('theme')); state.settings.accent=String(fd.get('accent'));
        submitBtn.disabled=true; submitBtn.textContent=cfg.deviceToken?'저장 중...':'연결 중...';
        try {
          await saveState(state);
          if (!cfg.deviceToken) {
            const result = await api.createTrip({ name: state.trip.title, city: state.trip.city, country: state.trip.country, startDate: state.trip.startDate, endDate: state.trip.endDate, state }, ownerKey);
            form.elements.ownerKey.value='';
            setConfig({ deviceToken: result.token, tripId: result.tripId, memberId: result.memberId, role:'OWNER' }); state.trip.id=result.tripId; state.revision=result.revision||0; if (result.members) state.members=result.members; await saveState(state); closeSheet(); renderAll(); toast('OWNER 가족 인증이 연결되었습니다.'); refreshWeather(); refreshExchange();
          } else {
            scheduleSync(); closeSheet(); renderAll(); toast('설정을 저장했습니다.');
          }
        } catch(err) {
          errorEl.textContent=err.message==='Failed to fetch'?'서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.':err.message;
          submitBtn.disabled=false; submitBtn.textContent=cfg.deviceToken?'설정 저장':'저장 및 가족 연결';
        }
      };
      $('[data-sheet-cancel]', form).onclick=closeSheet;
    });
}

async function searchPlaces(query) {
  const resultEl = $('#placeSearchResults'); resultEl.innerHTML = '<div class="empty-state">검색 중...</div>';
  try {
    const { places = [] } = await api.searchPlaces(query);
    resultEl.innerHTML = places.length ? places.map(p => `<article class="result-card" data-place-id="${esc(p.id)}"><div class="result-card__top"><div><h4>${esc(p.name)}</h4><p>${esc(p.address || '')}</p></div>${icon('map-pin')}</div><div class="card-actions"><button class="secondary-btn" data-action="save">${icon('bookmark-plus')}저장</button><button class="primary-btn" data-action="plan">${icon('calendar-plus')}일정에 추가</button></div></article>`).join('') : '<div class="empty-state">검색 결과가 없습니다.</div>';
    resultEl.dataset.results = JSON.stringify(places); createIcons();
  } catch(err) { resultEl.innerHTML = `<div class="empty-state">${esc(err.message)}<br>설정에서 Worker와 가족 공유 여행을 연결하세요.</div>`; }
}

async function refreshExchange() {
  try { const r = await api.exchange(); state.exchange = { rate:r.rate, day:r.day, source:r.source || 'worker' }; scheduleSave({sync:false}); updateCurrency(); toast('오늘 환율을 갱신했습니다.'); }
  catch(err) { toast(`환율 갱신 실패: ${err.message}`); }
}
async function refreshWeather({ announce = false } = {}) {
  const detail=$('#weatherDetail'), button=$('#refreshWeatherBtn');
  if (!getConfig().deviceToken) { detail.textContent='가족 인증 연결 후 갱신'; if(announce)toast('가족 인증 연결 후 날씨를 갱신할 수 있습니다.'); return; }
  detail.textContent='날씨 불러오는 중...'; button.disabled=true; button.classList.add('is-loading');
  try {
    const w = await api.weather(state.trip.lat,state.trip.lng); const temperature=Number(w.current?.temperature), wind=Number(w.current?.windSpeed); if(!Number.isFinite(temperature)||!Number.isFinite(wind))throw new Error('날씨 응답이 올바르지 않습니다.');
    $('#weatherMain').textContent = `${Math.round(temperature)}° · ${w.summary}`; detail.textContent = `강수 ${w.daily?.precipitationProbability ?? 0}% · 바람 ${Math.round(wind)}km/h`; if(announce)toast('날씨를 갱신했습니다.');
  } catch(err) { detail.textContent = `갱신 실패 · ${err.message}`; if(announce)toast(`날씨 갱신 실패: ${err.message}`); }
  finally { button.disabled=false; button.classList.remove('is-loading'); }
}

async function refreshRoutes() {
  const day = activeDay(); if (!day || day.items.length < 2) return toast('이동시간을 계산할 일정이 부족합니다.');
  let done=0;
  for (let i=0;i<day.items.length-1;i++) {
    const a=day.items[i], b=day.items[i+1]; if (!a.placeId || !b.placeId) continue;
    try {
      const [drive,walk] = await Promise.all([api.route({placeId:a.placeId},{placeId:b.placeId},'DRIVE'), api.route({placeId:a.placeId},{placeId:b.placeId},'WALK')]);
      a.routeToNext={ driveSec:drive.durationSeconds, walkSec:walk.durationSeconds, driveText:`차량 / Grab ${minutesText(drive.durationSeconds)}`, walkText:`도보 ${minutesText(walk.durationSeconds)}`, updatedAt:new Date().toISOString() }; done++;
    } catch(err) { if (err.status===401) return toast('가족 공유 여행 연결 후 Google 경로를 사용할 수 있습니다.'); }
  }
  scheduleSave(); renderAll(); toast(done ? `${done}개 구간의 이동시간을 갱신했습니다.` : 'Place ID가 있는 일정이 필요합니다.');
}

async function recommendRoute() {
  const day = activeDay(); if (!day || day.items.length < 3) return toast('동선 추천은 장소가 3개 이상일 때 사용할 수 있습니다.');
  if (day.items.some(i=>!i.placeId)) return toast('Google Places로 저장된 장소만 동선 추천에 사용할 수 있습니다.');
  try {
    const r = await api.optimize({ items: day.items.map(i=>({ id:i.id, placeId:i.placeId, locked:Boolean(i.locked) })) });
    if (!r.order || r.order.join('|') === day.items.map(i=>i.id).join('|')) return toast('현재 순서가 이미 효율적입니다.');
    const suggested = r.order.map(id=>day.items.find(i=>i.id===id)).filter(Boolean);
    openSheet('추천 동선', 'ROUTE SUGGESTION', `<p class="helper-text">잠긴 일정은 기준점으로 유지하고, 그 사이 일정만 Google Routes 기준으로 재정렬합니다. 자동으로 변경하지 않습니다.</p><div class="simple-list">${suggested.map((x,i)=>`<div class="simple-row"><strong>${i+1}</strong><div style="flex:1"><h4>${esc(x.name)}</h4><small class="muted">${x.locked?'잠금 일정':'이동 가능'}</small></div></div>`).join('')}</div><div class="sheet-actions"><button class="secondary-btn" data-sheet-cancel type="button">취소</button><button class="primary-btn" id="applyRouteSuggestion" type="button">이 순서로 변경</button></div>`, () => {
      $('[data-sheet-cancel]').onclick=closeSheet; $('#applyRouteSuggestion').onclick=()=>{ day.items=suggested; scheduleSave(); closeSheet(); renderAll(); toast('추천 동선을 적용했습니다.'); };
    });
  } catch(err) { toast(err.message); }
}

async function useCurrentLocation() {
  if (!navigator.geolocation) return toast('이 기기에서는 위치 기능을 사용할 수 없습니다.');
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null;
    $('#useLocationBtn span').textContent = '현재 위치'; toast('실시간 GPS를 중지했습니다.'); return;
  }
  $('#useLocationBtn span').textContent = 'GPS 사용 중';
  gpsWatchId = navigator.geolocation.watchPosition(async pos => {
    currentPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() };
    const day = getTodayTripDay(), next = findNextItem(day);
    if (!next?.placeId || Date.now() - lastLiveRouteAt < 30000) return;
    lastLiveRouteAt = Date.now();
    try {
      const [d,w]=await Promise.all([
        api.route({lat:currentPosition.lat,lng:currentPosition.lng},{placeId:next.placeId},'DRIVE'),
        api.route({lat:currentPosition.lat,lng:currentPosition.lng},{placeId:next.placeId},'WALK')
      ]);
      next.routeFromCurrent={driveText:`차량 / Grab ${minutesText(d.durationSeconds)}`,walkText:`도보 ${minutesText(w.durationSeconds)}`}; renderHome(); createIcons();
    } catch(err){ /* GPS 자체는 유지하고 경로 실패만 무시 */ }
  }, err => { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId=null; $('#useLocationBtn span').textContent='현재 위치'; toast(`위치 확인 실패: ${err.message}`); }, { enableHighAccuracy:true, timeout:12000, maximumAge:10000 });
  toast('실시간 GPS를 시작했습니다. 다시 누르면 중지합니다.');
}

async function pushSync() {
  const cfg=getConfig(); if (!cfg.deviceToken) return;
  try {
    const r=await api.putTrip({ baseRevision:state.revision||0, state }); state.revision=r.revision; $('#syncBadge').textContent='동기화됨';
  } catch(err) {
    if (err.status===409 && err.data?.state) { state=normalizeState(err.data.state); state.revision=err.data.revision; await saveState(state); renderAll(); toast('가족이 먼저 수정하여 최신 일정을 불러왔습니다.'); }
    else { $('#syncBadge').textContent='오프라인'; }
  }
}
async function pullSync() {
  const cfg=getConfig(); if (!cfg.deviceToken) return toast('가족 공유 여행에 연결되어 있지 않습니다.');
  try { const r=await api.getTrip(); state=normalizeState(r.state); state.revision=r.revision; if (r.members) state.members=r.members; await saveState(state); try { const l=await api.getLocations(); sharedLocations=l.locations||[]; } catch {} renderAll(); toast('최신 가족 일정을 불러왔습니다.'); }
  catch(err){ toast(err.message); }
}

function addExpenseSheet(vnd) {
  const krw=Math.round(vnd*state.exchange.rate); const today=dateKeyInZone();
  openSheet('지출 기록', 'TRAVEL BUDGET', `<form id="expenseForm" class="form-grid"><div class="form-field"><label>내용</label><input name="title" placeholder="점심 식사" required></div><div class="form-grid two"><div class="form-field"><label>베트남 동</label><input name="vnd" inputmode="numeric" value="${vnd.toLocaleString()}"></div><div class="form-field"><label>한화</label><input name="krw" inputmode="numeric" value="${krw.toLocaleString()}"></div></div><div class="form-grid two"><div class="form-field"><label>날짜</label>${nativeDateInput({ name:'date', value:today })}</div><div class="form-field"><label>분류</label><select name="category"><option>식비</option><option>교통</option><option>쇼핑</option><option>관광</option><option>숙박</option><option>기타</option></select></div></div><div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet-cancel>취소</button><button type="submit" class="primary-btn">저장</button></div></form>`,()=>{
    const form=$('#expenseForm'); $('[data-sheet-cancel]').onclick=closeSheet; form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form);state.expenses.push({id:uid('exp'),title:String(fd.get('title')),vnd:Number(rawDigits(fd.get('vnd'))),krw:Number(rawDigits(fd.get('krw'))),date:String(fd.get('date')),category:String(fd.get('category')),rate:state.exchange.rate,createdAt:new Date().toISOString()});scheduleSave();closeSheet();renderAll();toast('가계부에 기록했습니다.');};
  });
}

function addChecklistSheet() { openSheet('체크리스트 추가','PREP',`<form id="checkForm" class="form-grid"><div class="form-field"><label>항목</label><input name="title" required placeholder="상비약"></div><div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet-cancel>취소</button><button class="primary-btn">추가</button></div></form>`,()=>{const f=$('#checkForm');$('[data-sheet-cancel]').onclick=closeSheet;f.onsubmit=e=>{e.preventDefault();state.checklist.push({id:uid('check'),title:new FormData(f).get('title'),done:false});scheduleSave();closeSheet();renderAll();};}); }
function confirmChecklistRemoval(item) { openSheet('체크리스트 삭제','CONFIRM',`<div class="auth-card">${icon('trash-2')}<div><strong>${esc(item.title)}</strong><p>이 항목을 삭제할까요? 삭제한 항목은 되돌릴 수 없습니다.</p></div></div><div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet-cancel>취소</button><button type="button" class="danger-btn" id="confirmChecklistDelete">삭제</button></div>`,()=>{$('[data-sheet-cancel]').onclick=closeSheet;$('#confirmChecklistDelete').onclick=()=>{state.checklist=state.checklist.filter(x=>x.id!==item.id);scheduleSave();closeSheet();renderChecklist();createIcons();toast('체크리스트 항목을 삭제했습니다.');};}); }
function addDocumentSheet() { openSheet('예약 · 문서 추가','BOOKING',`<form id="docForm" class="form-grid"><div class="form-field"><label>제목</label><input name="title" required placeholder="아미아나 리조트"></div><div class="form-grid two"><div class="form-field"><label>종류</label><select name="type"><option>숙소</option><option>항공</option><option>보험</option><option>eSIM</option><option>투어</option><option>기타</option></select></div><div class="form-field"><label>날짜 · 선택</label>${nativeDateInput({ name:'date' })}</div></div><div class="form-field"><label>링크 · 선택</label><input name="url" type="url" placeholder="https://"></div><div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet-cancel>취소</button><button class="primary-btn">저장</button></div></form>`,()=>{const f=$('#docForm');$('[data-sheet-cancel]').onclick=closeSheet;f.onsubmit=e=>{e.preventDefault();const fd=new FormData(f);state.documents.push({id:uid('doc'),title:fd.get('title'),type:fd.get('type'),date:fd.get('date'),url:fd.get('url')});scheduleSave();closeSheet();renderAll();};}); }

function bindEvents() {
  $$('.nav-item').forEach(b => b.addEventListener('click',()=>go(b.dataset.nav)));
  $('#quickSettingsBtn').onclick=openSettings; $('#closeSheetBtn').onclick=closeSheet; $('#sheetBackdrop').onclick=closeSheet;
  $('#modalCancelBtn').onclick=closeModal; $('#modalBackdrop').onclick=closeModal; $('#modalConfirmBtn').onclick=()=>{ const u=pendingExternalUrl; closeModal(); if(u) window.open(u,'_blank','noopener,noreferrer'); };
  $('#addPlanItemBtn').onclick=()=>openPlanEditor(); $('#useLocationBtn').onclick=useCurrentLocation;
  $('#openNextMapBtn').onclick=()=>{const d=getTodayTripDay(), n=findNextItem(d); if(n) openPlaceMap(n); else openCityMap();};
  $('#dayTabs').addEventListener('click',e=>{const b=e.target.closest('[data-day-id]');if(!b)return;state.settings.activeDayId=b.dataset.dayId;scheduleSave({sync:false});renderPlan();createIcons();});
  $('#planList').addEventListener('click',e=>{const card=e.target.closest('[data-item-id]');const btn=e.target.closest('[data-action]');if(!card||!btn)return;const day=activeDay(),idx=day.items.findIndex(i=>i.id===card.dataset.itemId),item=day.items[idx];if(btn.dataset.action==='edit')openPlanEditor(item);if(btn.dataset.action==='up'&&idx>0){[day.items[idx-1],day.items[idx]]=[day.items[idx],day.items[idx-1]];scheduleSave();renderPlan();createIcons();}});
  $('#refreshRoutesBtn').onclick=refreshRoutes; $('#recommendRouteBtn').onclick=recommendRoute;
  $('#placeSearchForm').onsubmit=e=>{e.preventDefault();const q=$('#placeSearchInput').value.trim();if(q)searchPlaces(q);};
  $('#placeSearchResults').addEventListener('click',e=>{const card=e.target.closest('[data-place-id]'),btn=e.target.closest('[data-action]');if(!card||!btn)return;const places=JSON.parse($('#placeSearchResults').dataset.results||'[]'),p=places.find(x=>x.id===card.dataset.placeId);if(!p)return;if(btn.dataset.action==='save'){if(!state.favorites.some(f=>f.placeId===p.id))state.favorites.push({id:uid('fav'),placeId:p.id,name:p.name,category:'기타'});scheduleSave();renderSaved();createIcons();toast('가고 싶은 곳에 저장했습니다.');}else openPlanEditor(null,{name:p.name,placeId:p.id});});
  $('#favoritesList').addEventListener('click',e=>{const c=e.target.closest('[data-fav-id]'),b=e.target.closest('[data-action]');if(!c||!b)return;const f=state.favorites.find(x=>x.id===c.dataset.favId);if(b.dataset.action==='remove'){state.favorites=state.favorites.filter(x=>x.id!==f.id);scheduleSave();renderSaved();createIcons();}if(b.dataset.action==='add-plan')openPlanEditor(null,{name:f.name,placeId:f.placeId,category:f.category});if(b.dataset.action==='map')openPlaceMap(f);});
  $('#vndInput').addEventListener('input',e=>{const pos=e.target.selectionStart;e.target.value=formatNumberInput(e.target.value);updateCurrency();});
  $('#quickAmounts').addEventListener('click',e=>{const b=e.target.closest('[data-vnd]');if(!b)return;$('#vndInput').value=Number(b.dataset.vnd).toLocaleString();updateCurrency();});
  $('#refreshRateBtn').onclick=refreshExchange; $('#refreshWeatherBtn').onclick=()=>refreshWeather({announce:true}); $('#addExpenseFromCalcBtn').onclick=()=>{const v=Number(rawDigits($('#vndInput').value));if(!v)return toast('베트남 동 금액을 입력하세요.');addExpenseSheet(v);};
  $('#addChecklistBtn').onclick=addChecklistSheet; $('#checklist').addEventListener('change',e=>{const row=e.target.closest('[data-check-id]');if(!row)return;const c=state.checklist.find(x=>x.id===row.dataset.checkId);c.done=e.target.checked;scheduleSave();renderChecklist();}); $('#checklist').addEventListener('click',e=>{const b=e.target.closest('[data-action="remove"]');if(!b)return;const row=b.closest('[data-check-id]');const item=state.checklist.find(x=>x.id===row.dataset.checkId);if(item)confirmChecklistRemoval(item);});
  $('#addDocumentBtn').onclick=addDocumentSheet; $('#documentsList').addEventListener('click',e=>{const b=e.target.closest('[data-action="open"]'),row=e.target.closest('[data-doc-id]');if(!b||!row)return;const d=state.documents.find(x=>x.id===row.dataset.docId);confirmExternal(d.title,d.url);});
  $('#externalTools').addEventListener('click',e=>{const b=e.target.closest('[data-url]');if(b)confirmExternal(b.dataset.name,b.dataset.url);});
  $('#syncNowBtn').onclick=pullSync; $('#inviteMemberBtn').onclick=inviteMember; $('#shareLocationBtn').onclick=shareMyLocation;
  $('#familyLocations').addEventListener('click',e=>{const row=e.target.closest('[data-lat]'),b=e.target.closest('[data-action="location-map"]');if(!row||!b)return;const url=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.dataset.lat+','+row.dataset.lng)}`;confirmExternal('Google Maps',url,'가족이 공유한 위치를 Google Maps에서 확인합니다.');});
  $('#membersList').addEventListener('click',e=>{const row=e.target.closest('[data-member-id]'),b=e.target.closest('[data-action]');if(!row||!b)return;if(b.dataset.action==='role')changeRole(row.dataset.memberId);if(b.dataset.action==='name')changeMemberName(row.dataset.memberId);});

  const sheet = $('#bottomSheet');
  const sheetHandle = $('.sheet-handle', sheet);
  let sheetDrag = null;
  sheetHandle.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sheetDrag = { id: e.pointerId, startY: e.clientY, startedAt: performance.now() };
    sheetHandle.setPointerCapture(e.pointerId);
    sheet.classList.add('is-dragging');
    e.preventDefault();
  });
  const moveSheetDrag = e => {
    if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
    const distance = Math.max(0, e.clientY - sheetDrag.startY);
    sheet.style.setProperty('--sheet-drag-y', `${distance}px`);
    e.preventDefault();
  };
  const finishSheetDrag = (e, cancelled = false) => {
    if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
    const distance = Math.max(0, e.clientY - sheetDrag.startY);
    const velocity = distance / Math.max(1, performance.now() - sheetDrag.startedAt);
    sheetDrag = null;
    if (sheetHandle.hasPointerCapture(e.pointerId)) sheetHandle.releasePointerCapture(e.pointerId);
    if (!cancelled && (distance > Math.min(120, sheet.offsetHeight * .22) || (distance > 56 && velocity > .9))) {
      dismissSheetFromDrag();
      return;
    }
    sheet.classList.remove('is-dragging');
    sheet.style.setProperty('--sheet-drag-y', '0px');
  };
  window.addEventListener('pointermove', moveSheetDrag, { passive: false });
  window.addEventListener('pointerup', e => finishSheetDrag(e));
  window.addEventListener('pointercancel', e => finishSheetDrag(e, true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
}
function openPlaceMap(place) {
  const url=place.placeId ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.placeId)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
  confirmExternal('Google Maps',url,'장소 확인을 위해 Google Maps 앱 또는 웹사이트로 이동합니다.');
}
function openCityMap() { const query=[state.trip.city,state.trip.country].filter(Boolean).join(', ')||'Nha Trang, Vietnam'; confirmExternal('Google Maps',`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,'등록된 다음 일정이 없어 여행지 지도를 엽니다.'); }
async function inviteMember() {
  if (getConfig().role!=='OWNER') return toast('OWNER만 가족을 초대할 수 있습니다.');
  try { const r=await api.invite('EDITOR'); openSheet('가족 초대','FAMILY',`<p>아래 링크를 가족에게 보내세요. 링크는 1회 사용 후 만료됩니다.</p><div class="auth-card">${icon('key-round')}<div><strong>인증 토큰은 자동으로 발급됩니다</strong><p>가족이 링크를 열고 이름을 입력하면 해당 기기에만 토큰이 저장됩니다. 토큰을 복사하거나 서로 전달할 필요가 없습니다. 브라우저 데이터를 삭제하거나 기기를 바꾸면 새 초대 링크가 필요합니다.</p></div></div><div class="form-field"><label>초대 링크</label><input id="inviteUrl" readonly value="${esc(r.inviteUrl)}"></div><div class="sheet-actions"><button class="secondary-btn" data-sheet-cancel>닫기</button><button id="copyInvite" class="primary-btn">링크 복사</button></div>`,()=>{$('[data-sheet-cancel]').onclick=closeSheet;$('#copyInvite').onclick=async()=>{await navigator.clipboard.writeText(r.inviteUrl);toast('초대 링크를 복사했습니다.');};}); } catch(err){toast(err.message);} }
function changeRole(memberId) { openSheet('가족 권한 변경','PERMISSION',`<div class="form-field"><label>권한</label><select id="roleSelect"><option value="EDITOR">EDITOR · 일정 편집 가능</option><option value="VIEWER">VIEWER · 보기만 가능</option></select></div><div class="sheet-actions"><button class="secondary-btn" data-sheet-cancel>취소</button><button class="primary-btn" id="saveRole">적용</button></div>`,()=>{$('[data-sheet-cancel]').onclick=closeSheet;$('#saveRole').onclick=async()=>{try{await api.setRole(memberId,$('#roleSelect').value);closeSheet();await pullSync();}catch(err){toast(err.message);}};}); }
function changeMemberName(memberId) {
  const member=state.members.find(item=>item.id===memberId); if(!member)return;
  openSheet('가족 이름 변경','FAMILY',`<form id="memberNameForm" class="form-grid"><div class="form-field"><label for="memberName">표시할 이름</label><input id="memberName" name="name" maxlength="40" value="${esc(member.name)}" required autocomplete="name"></div><p id="memberNameError" class="form-error" role="alert"></p><div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet-cancel>취소</button><button type="submit" class="primary-btn">저장</button></div></form>`,()=>{const form=$('#memberNameForm');$('[data-sheet-cancel]').onclick=closeSheet;form.onsubmit=async e=>{e.preventDefault();const name=String(new FormData(form).get('name')||'').trim();if(!name){$('#memberNameError').textContent='이름을 입력하세요.';return;}try{if(getConfig().deviceToken){const result=await api.setMemberName(memberId,name);member.name=result.member?.name||name;}else{member.name=name;}await saveState(state);closeSheet();renderMembers();createIcons();toast('가족 이름을 변경했습니다.');}catch(err){$('#memberNameError').textContent=err.message;}};});
}

async function shareMyLocation() {
  if (!getConfig().deviceToken) return toast('가족 공유 여행에 연결한 뒤 위치를 공유할 수 있습니다.');
  if (!navigator.geolocation) return toast('이 기기에서는 위치 기능을 사용할 수 없습니다.');
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      await api.shareLocation(pos.coords.latitude, pos.coords.longitude);
      const r=await api.getLocations(); sharedLocations=r.locations||[]; renderFamilyLocations(); createIcons(); toast('현재 위치를 가족에게 공유했습니다.');
    } catch(err) { toast(err.message); }
  }, err => toast(`위치 확인 실패: ${err.message}`), { enableHighAccuracy:true, timeout:12000, maximumAge:15000 });
}

async function handleInviteFromUrl() {
  const code=new URL(location.href).searchParams.get('invite'); if(!code)return;
  history.replaceState({},'',location.pathname);
  openSheet('가족여행 참여','INVITE',`<form id="joinForm" class="form-grid"><p>가족이 공유한 여행에 참여합니다. 별도 회원가입은 없습니다.</p><div class="form-field"><label>이 기기에서 사용할 이름</label><input name="name" required placeholder="엄마"></div><div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet-cancel>취소</button><button class="primary-btn">참여하기</button></div></form>`,()=>{const f=$('#joinForm');$('[data-sheet-cancel]').onclick=closeSheet;f.onsubmit=async e=>{e.preventDefault();try{const r=await api.joinInvite({code,name:new FormData(f).get('name')});setConfig({deviceToken:r.token,tripId:r.tripId,memberId:r.memberId,role:r.role});state=normalizeState(r.state);state.revision=r.revision;if(r.members)state.members=r.members;await saveState(state);closeSheet();renderAll();toast('가족여행에 참여했습니다.');}catch(err){toast(err.message);}};});
}

async function init() {
  state=await loadState(); applyTheme(); bindEvents(); renderAll();
  setInterval(renderClocks, 30000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  setTimeout(async()=>{ if(getConfig().deviceToken){ refreshWeather(); refreshExchange(); try{ const l=await api.getLocations(); sharedLocations=l.locations||[]; renderFamilyLocations(); createIcons(); }catch{} } else { $('#weatherDetail').textContent='가족 인증 연결 후 갱신'; } }, 700);
  await handleInviteFromUrl();
}

init();
