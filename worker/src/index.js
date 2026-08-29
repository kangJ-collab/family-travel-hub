import { DurableObject } from 'cloudflare:workers';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', ...extra } });
const nowIso = () => new Date().toISOString();
const PUBLIC_APP_ID = 'FamilyTravelHub/2.0 (+https://github.com/kangJ-collab/family-travel-hub)';
const OSM_ATTRIBUTION = { label:'© OpenStreetMap contributors', url:'https://www.openstreetmap.org/copyright' };
const OSRM_ATTRIBUTION = { label:'Routing by OSRM', url:'https://project-osrm.org/' };
const rand = (bytes=24) => { const a=new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
const inviteCode = () => { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes=new Uint8Array(8); crypto.getRandomValues(bytes); const raw=[...bytes].map(value=>chars[value&31]).join(''); return `${raw.slice(0,4)}-${raw.slice(4)}`; };
const normalizeInviteCode = value => String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function sha256(v) { const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function cors(req, env) { const origin=req.headers.get('Origin')||''; const allowed=(env.APP_ORIGIN||'').split(',').map(s=>s.trim()).filter(Boolean); const value=allowed.includes(origin)?origin:(allowed[0]||'*'); return {'Access-Control-Allow-Origin':value,'Vary':'Origin','Access-Control-Allow-Headers':'content-type,authorization,x-owner-key','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'}; }
function bodyLimit(req, max=600000){const len=Number(req.headers.get('content-length')||0);if(len>max)throw Object.assign(new Error('요청 데이터가 너무 큽니다.'),{status:413});}
function safeTextEqual(leftValue,rightValue){const enc=new TextEncoder(),left=enc.encode(String(leftValue||'')),right=enc.encode(String(rightValue||''));return left.byteLength===right.byteLength&&crypto.subtle.timingSafeEqual(left,right);}
function requireOwnerBootstrap(req,env){if(!env.OWNER_BOOTSTRAP_KEY)throw Object.assign(new Error('OWNER_BOOTSTRAP_KEY Worker Secret이 설정되지 않았습니다.'),{status:503});if(!safeTextEqual(req.headers.get('X-Owner-Key'),env.OWNER_BOOTSTRAP_KEY))throw Object.assign(new Error('OWNER 설정키가 올바르지 않습니다.'),{status:403});}

async function auth(req, env) {
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim(); if(!token) throw Object.assign(new Error('가족 여행 연결이 필요합니다.'),{status:401});
  const hash=await sha256(token);
  const row=await env.DB.prepare(`SELECT dt.id device_id, dt.member_id, m.trip_id, m.name, m.role FROM device_tokens dt JOIN members m ON m.id=dt.member_id WHERE dt.token_hash=? AND dt.revoked_at IS NULL`).bind(hash).first();
  if(!row) throw Object.assign(new Error('인증 정보가 유효하지 않습니다.'),{status:401}); return row;
}
function canEdit(role){return role==='OWNER'||role==='EDITOR';}
async function limitInviteJoin(req,env){if(!env.PUBLIC_API_RATE_LIMITER)return;const key=req.headers.get('CF-Connecting-IP')||'local';const {success}=await env.PUBLIC_API_RATE_LIMITER.limit({key:`invite:${key}`});if(!success)throw Object.assign(new Error('참여 코드 입력이 너무 많습니다. 잠시 후 다시 시도하세요.'),{status:429});}
async function limitPublicApi(me,env){if(!env.PUBLIC_API_RATE_LIMITER)throw Object.assign(new Error('공개 API 사용량 제한이 설정되지 않았습니다.'),{status:503});const {success}=await env.PUBLIC_API_RATE_LIMITER.limit({key:`member:${me.member_id}`});if(!success)throw Object.assign(new Error('장소 또는 경로 요청이 너무 많습니다. 잠시 후 다시 시도하세요.'),{status:429});}
function coordinate(input) {
  if(input?.lat===null||input?.lat===undefined||input?.lat===''||input?.lng===null||input?.lng===undefined||input?.lng==='')throw Object.assign(new Error('유효한 위치 좌표가 필요합니다.'),{status:400});
  const lat=Number(input?.lat), lng=Number(input?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180) throw Object.assign(new Error('유효한 위치 좌표가 필요합니다.'),{status:400});
  return {lat,lng};
}
function coordinateText(input){const point=coordinate(input);return `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`;}
function publicHeaders(){return {'Accept':'application/json','Accept-Language':'ko,en;q=0.8,vi;q=0.7','Referer':'https://kangj-collab.github.io/family-travel-hub/','User-Agent':PUBLIC_APP_ID};}

export class PublicApiGate extends DurableObject {
  async waitForTurn(intervalMs=1100,maxQueueMs=12000) {
    const interval=Math.max(1000,Math.min(5000,Number(intervalMs)||1100)), now=Date.now();
    const startAt=await this.ctx.storage.transaction(async transaction=>{
      const nextAt=Number(await transaction.get('nextAt')||0), reservedAt=Math.max(now,nextAt);
      if(reservedAt-now>maxQueueMs)return -1;
      await transaction.put('nextAt',reservedAt+interval);
      return reservedAt;
    });
    if(startAt<0)throw new Error('무료 지도 서버 요청이 몰렸습니다. 잠시 후 다시 시도하세요.');
    const waitMs=Math.max(0,startAt-Date.now());
    if(waitMs)await scheduler.wait(waitMs);
    return waitMs;
  }
}

async function waitForPublicService(env,service) {
  if(!env.PUBLIC_API_GATE)throw Object.assign(new Error('공개 API 호출 게이트가 설정되지 않았습니다.'),{status:503});
  try { await env.PUBLIC_API_GATE.getByName(service,{locationHint:'apac-se'}).waitForTurn(1100,12000); }
  catch(error){throw Object.assign(new Error(error?.message||'무료 지도 서버 요청 대기 중 오류가 발생했습니다.'),{status:429});}
}
async function readPublicJson(url,env,service,errorMessage) {
  await waitForPublicService(env,service);
  const response=await fetch(url,{headers:publicHeaders(),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.message||data?.error||errorMessage),{status:response.status===429?429:502});
  return data;
}
async function cachedPublicJson(namespace,signature,ttlSeconds,ctx,loader) {
  const cache=caches.default, digest=await sha256(signature), key=new Request(`https://family-travel-hub-cache.invalid/${namespace}/${digest}`);
  const cached=await cache.match(key);
  if(cached)return {data:await cached.json(),cacheHit:true};
  const data=await loader(), cacheResponse=json(data,200,{'Cache-Control':`public, max-age=${ttlSeconds}`});
  ctx.waitUntil(cache.put(key,cacheResponse).catch(error=>console.error(JSON.stringify({message:'public cache write failed',namespace,error:String(error)}))));
  return {data,cacheHit:false};
}
function osmPlace(item) {
  const lat=Number(item?.lat),lng=Number(item?.lon); if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
  const osmType=String(item.osm_type||''),osmId=String(item.osm_id||''),fallbackId=String(item.place_id||'');
  const names=item.namedetails||{}, name=String(item.name||names['name:ko']||names.name||names['name:vi']||item.display_name||'').split(',')[0].trim();
  return {id:osmType&&osmId?`${osmType}:${osmId}`:`place:${fallbackId}`,osmType,osmId,name,address:String(item.display_name||''),lat,lng,kind:String(item.type||''),category:String(item.category||'')};
}
function osrmBase(mode){return mode==='WALK'?'https://routing.openstreetmap.de/routed-foot':'https://routing.openstreetmap.de/routed-car';}

async function handle(req, env, ctx) {
  const url=new URL(req.url), p=url.pathname;
  if(req.method==='GET'&&p==='/api/health') return json({ok:true,version:'2.0.0',providers:{places:'Nominatim',routes:'OSRM',weather:'Open-Meteo',exchange:'open.er-api'},googleApiKeyRequired:false});

  if(req.method==='POST'&&p==='/api/trips/create') {
    bodyLimit(req); requireOwnerBootstrap(req,env); const input=await req.json(); const tripId=crypto.randomUUID(), memberId=crypto.randomUUID(), token=rand(32), tokenHash=await sha256(token); const state=input.state||{}; state.trip={...(state.trip||{}),id:tripId}; state.revision=1;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO trips(id,name,city,country,start_date,end_date,state_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(tripId,input.name||'가족여행',input.city||'',input.country||'',input.startDate||'',input.endDate||'',JSON.stringify(state),1,nowIso(),nowIso()),
      env.DB.prepare('INSERT INTO members(id,trip_id,name,role,created_at) VALUES(?,?,?,?,?)').bind(memberId,tripId,'제작자','OWNER',nowIso()),
      env.DB.prepare('INSERT INTO device_tokens(id,member_id,token_hash,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),memberId,tokenHash,nowIso())
    ]);
    return json({tripId,memberId,token,role:'OWNER',revision:1,members:[{id:memberId,name:'제작자',role:'OWNER',created_at:nowIso()}]});
  }

  if(req.method==='POST'&&p==='/api/invites/create') {
    const me=await auth(req,env); if(me.role!=='OWNER') throw Object.assign(new Error('OWNER만 초대할 수 있습니다.'),{status:403}); const {role='EDITOR'}=await req.json(); if(!['EDITOR','VIEWER'].includes(role)) throw Object.assign(new Error('허용되지 않은 권한입니다.'),{status:400});
    const code=inviteCode(), hash=await sha256(normalizeInviteCode(code)), expires=new Date(Date.now()+10*60*1000).toISOString();
    await env.DB.prepare('INSERT INTO invites(id,trip_id,code_hash,role,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),me.trip_id,hash,role,expires,nowIso()).run();
    const base=(env.APP_BASE_URL||env.APP_ORIGIN||new URL(req.url).origin).split(',')[0].replace(/\/$/,''); return json({inviteCode:code,appUrl:base,expiresAt:expires},200,{'Cache-Control':'no-store'});
  }

  if(req.method==='POST'&&p==='/api/invites/join') {
    bodyLimit(req,10000); await limitInviteJoin(req,env); const input=await req.json(), code=normalizeInviteCode(input.code), name=String(input.name||'').trim().slice(0,40);
    if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw Object.assign(new Error('참여 코드 8자리를 확인하세요.'),{status:400});
    if(!name) throw Object.assign(new Error('가족 이름을 입력하세요.'),{status:400});
    const hash=await sha256(code), inv=await env.DB.prepare('SELECT id,trip_id,role FROM invites WHERE code_hash=? AND used_at IS NULL AND expires_at>?').bind(hash,nowIso()).first();
    if(!inv) throw Object.assign(new Error('참여 코드가 만료되었거나 이미 사용되었습니다.'),{status:400});
    const claimedAt=nowIso(), claim=await env.DB.prepare('UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?').bind(claimedAt,inv.id,claimedAt).run();
    if(Number(claim.meta?.changes)!==1) throw Object.assign(new Error('참여 코드가 이미 사용되었습니다.'),{status:409});
    const memberId=crypto.randomUUID(), token=rand(32), tokenHash=await sha256(token), trip=await env.DB.prepare('SELECT state_json,revision FROM trips WHERE id=?').bind(inv.trip_id).first();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO members(id,trip_id,name,role,created_at) VALUES(?,?,?,?,?)').bind(memberId,inv.trip_id,name,inv.role,claimedAt),
      env.DB.prepare('INSERT INTO device_tokens(id,member_id,token_hash,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),memberId,tokenHash,claimedAt)
    ]);
    const members=await env.DB.prepare('SELECT id,name,role,created_at FROM members WHERE trip_id=? ORDER BY created_at').bind(inv.trip_id).all(); return json({tripId:inv.trip_id,memberId,token,role:inv.role,state:JSON.parse(trip.state_json),revision:trip.revision,members:members.results},200,{'Cache-Control':'no-store'});
  }

  if(req.method==='GET'&&p==='/api/trip') {
    const me=await auth(req,env), trip=await env.DB.prepare('SELECT state_json,revision FROM trips WHERE id=?').bind(me.trip_id).first(), members=await env.DB.prepare('SELECT id,name,role,created_at FROM members WHERE trip_id=? ORDER BY created_at').bind(me.trip_id).all();
    return json({state:JSON.parse(trip.state_json),revision:trip.revision,members:members.results});
  }

  if(req.method==='PUT'&&p==='/api/trip') {
    bodyLimit(req); const me=await auth(req,env); if(!canEdit(me.role)) throw Object.assign(new Error('보기 전용 권한입니다.'),{status:403}); const input=await req.json(), current=await env.DB.prepare('SELECT revision,state_json FROM trips WHERE id=?').bind(me.trip_id).first();
    if(Number(input.baseRevision)!==Number(current.revision)) return json({error:'다른 가족이 먼저 수정했습니다.',revision:current.revision,state:JSON.parse(current.state_json)},409);
    const nextRev=current.revision+1; input.state.revision=nextRev; await env.DB.prepare('UPDATE trips SET state_json=?,revision=?,updated_at=? WHERE id=?').bind(JSON.stringify(input.state),nextRev,nowIso(),me.trip_id).run(); return json({ok:true,revision:nextRev});
  }

  if(req.method==='GET'&&p==='/api/members') { const me=await auth(req,env), rows=await env.DB.prepare('SELECT id,name,role,created_at FROM members WHERE trip_id=? ORDER BY created_at').bind(me.trip_id).all(); return json({members:rows.results}); }
  const memberMatch=p.match(/^\/api\/members\/([^/]+)$/);
  if(memberMatch&&req.method==='PATCH') {
    bodyLimit(req,10000); const me=await auth(req,env), input=await req.json(), targetId=memberMatch[1];
    const target=await env.DB.prepare('SELECT id,name,role,created_at FROM members WHERE id=? AND trip_id=?').bind(targetId,me.trip_id).first();
    if(!target) throw Object.assign(new Error('가족 구성원을 찾을 수 없습니다.'),{status:404});
    const wantsName=Object.prototype.hasOwnProperty.call(input,'name'), wantsRole=Object.prototype.hasOwnProperty.call(input,'role');
    if(!wantsName&&!wantsRole) throw Object.assign(new Error('변경할 이름 또는 권한이 필요합니다.'),{status:400});
    let name=target.name, role=target.role;
    if(wantsName) { if(me.role!=='OWNER'&&me.member_id!==targetId) throw Object.assign(new Error('본인 이름만 변경할 수 있습니다.'),{status:403}); name=String(input.name||'').trim().slice(0,40); if(!name) throw Object.assign(new Error('이름을 입력하세요.'),{status:400}); }
    if(wantsRole) { if(me.role!=='OWNER') throw Object.assign(new Error('OWNER만 권한을 변경할 수 있습니다.'),{status:403}); if(target.role==='OWNER') throw Object.assign(new Error('OWNER 권한은 변경할 수 없습니다.'),{status:400}); if(!['EDITOR','VIEWER'].includes(input.role)) throw Object.assign(new Error('허용되지 않은 권한입니다.'),{status:400}); role=input.role; }
    await env.DB.prepare('UPDATE members SET name=?,role=? WHERE id=? AND trip_id=?').bind(name,role,targetId,me.trip_id).run();
    return json({ok:true,member:{id:target.id,name,role,created_at:target.created_at}});
  }

  if(req.method==='GET'&&p==='/api/places/search') {
    const me=await auth(req,env); await limitPublicApi(me,env); const q=(url.searchParams.get('q')||'').trim().slice(0,120); if(!q)return json({places:[],source:'Nominatim',attribution:OSM_ATTRIBUTION}); if(q.length<2)throw Object.assign(new Error('장소 검색어를 두 글자 이상 입력하세요.'),{status:400});
    const centerLat=Number(url.searchParams.get('lat')),centerLng=Number(url.searchParams.get('lng')),lat=Number.isFinite(centerLat)?centerLat:12.2388,lng=Number.isFinite(centerLng)?centerLng:109.1967;
    coordinate({lat,lng}); const params=new URLSearchParams({format:'jsonv2',q,limit:'8',addressdetails:'1',namedetails:'1',dedupe:'1','accept-language':'ko,en,vi',viewbox:`${lng-0.55},${lat+0.45},${lng+0.55},${lat-0.45}`,bounded:'1'});
    const country=String(url.searchParams.get('country')||'Vietnam').toLowerCase(); if(country.includes('vietnam')||country.includes('viet nam')||country.includes('베트남'))params.set('countrycodes','vn');
    const upstreamUrl=`https://nominatim.openstreetmap.org/search?${params}`;
    const result=await cachedPublicJson('nominatim-search',upstreamUrl,30*24*60*60,ctx,async()=>{
      const data=await readPublicJson(upstreamUrl,env,'nominatim','OpenStreetMap 장소 검색에 실패했습니다.');
      return {places:(Array.isArray(data)?data:[]).map(osmPlace).filter(Boolean)};
    });
    return json({...result.data,source:'Nominatim',cacheHit:result.cacheHit,attribution:OSM_ATTRIBUTION},200,{'Cache-Control':'no-store'});
  }

  if(req.method==='POST'&&p==='/api/routes') {
    bodyLimit(req,20000); const me=await auth(req,env); await limitPublicApi(me,env); const {origin,destination,mode='DRIVE'}=await req.json(); if(!['DRIVE','WALK'].includes(mode)) throw Object.assign(new Error('지원하지 않는 이동수단입니다.'),{status:400});
    const upstreamUrl=`${osrmBase(mode)}/route/v1/driving/${coordinateText(origin)};${coordinateText(destination)}?overview=false&steps=false&generate_hints=false`;
    const result=await cachedPublicJson(`osrm-${mode.toLowerCase()}-route`,upstreamUrl,24*60*60,ctx,async()=>{
      const data=await readPublicJson(upstreamUrl,env,'osrm',`${mode==='WALK'?'도보':'차량'} 경로 계산에 실패했습니다.`),route=data.routes?.[0];
      if(data.code!=='Ok'||!route)throw Object.assign(new Error(data.message||'두 장소를 잇는 경로를 찾지 못했습니다.'),{status:502});
      return {durationSeconds:Number(route.duration||0),distanceMeters:Number(route.distance||0)};
    });
    return json({...result.data,mode,source:'OSRM',cacheHit:result.cacheHit,attribution:[OSM_ATTRIBUTION,OSRM_ATTRIBUTION],warning:'공개 OSM 경로는 실시간 교통을 반영하지 않으며 실제 이동시간과 다를 수 있습니다.'},200,{'Cache-Control':'no-store'});
  }

  if(req.method==='POST'&&p==='/api/routes/optimize') {
    bodyLimit(req,50000); const me=await auth(req,env); await limitPublicApi(me,env); const {items=[]}=await req.json();
    if(!Array.isArray(items)||items.length>24||items.some(item=>!item?.id)) throw Object.assign(new Error('최적화할 장소 정보가 올바르지 않습니다.'),{status:400});
    items.forEach(item=>coordinate(item));
    if(items.length<3) return json({order:items.map(i=>i.id)});
    // 잠긴 장소를 경계로 구간을 나눈다. 각 구간의 시작/끝은 고정하고 중간 항목만 OSRM Trip이 최적화한다.
    let order=items.map(i=>i.id); const lockedIdx=items.map((x,i)=>x.locked?i:-1).filter(i=>i>=0); const boundaries=[0,...lockedIdx.filter(i=>i>0&&i<items.length-1),items.length-1].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
    for(let b=0;b<boundaries.length-1;b++) { const s=boundaries[b],e=boundaries[b+1]; if(e-s<2) continue; const segment=items.slice(s,e+1), mids=segment.slice(1,-1); if(mids.length<2) continue;
      if(segment.length>12)throw Object.assign(new Error('잠금 일정 사이의 장소가 12개를 넘습니다. 일정을 잠가 구간을 나눠주세요.'),{status:400});
      const upstreamUrl=`${osrmBase('DRIVE')}/trip/v1/driving/${segment.map(coordinateText).join(';')}?roundtrip=false&source=first&destination=last&overview=false&steps=false&generate_hints=false`;
      const result=await cachedPublicJson('osrm-trip',upstreamUrl,24*60*60,ctx,async()=>readPublicJson(upstreamUrl,env,'osrm','추천 동선 계산에 실패했습니다.'));
      const waypoints=result.data?.waypoints||[],ranks=waypoints.map(waypoint=>Number(waypoint?.waypoint_index)),valid=waypoints.length===segment.length&&new Set(ranks).size===segment.length&&ranks.every(rank=>Number.isInteger(rank)&&rank>=0&&rank<segment.length);
      if(!valid)continue;
      const segOrder=segment.map((item,index)=>({id:item.id,rank:ranks[index]})).sort((left,right)=>left.rank-right.rank).map(item=>item.id); order.splice(s,segment.length,...segOrder);
    }
    return json({order,source:'OSRM',attribution:[OSM_ATTRIBUTION,OSRM_ATTRIBUTION]},200,{'Cache-Control':'no-store'});
  }

  if(req.method==='POST'&&p==='/api/location/share') {
    const me=await auth(req,env); const {lat,lng}=await req.json(); if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))) throw Object.assign(new Error('유효한 위치가 필요합니다.'),{status:400});
    await env.DB.prepare('INSERT INTO shared_locations(member_id,trip_id,lat,lng,shared_at) VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,shared_at=excluded.shared_at').bind(me.member_id,me.trip_id,Number(lat),Number(lng),nowIso()).run(); return json({ok:true});
  }
  if(req.method==='GET'&&p==='/api/locations') {
    const me=await auth(req,env); const rows=await env.DB.prepare(`SELECT sl.member_id memberId,m.name,sl.lat,sl.lng,sl.shared_at sharedAt FROM shared_locations sl JOIN members m ON m.id=sl.member_id WHERE sl.trip_id=? AND sl.shared_at>? ORDER BY sl.shared_at DESC`).bind(me.trip_id,new Date(Date.now()-24*60*60*1000).toISOString()).all(); return json({locations:rows.results});
  }

  if(req.method==='GET'&&p==='/api/exchange') {
    await auth(req,env); const day=new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10); const cached=await env.DB.prepare('SELECT rate,source FROM daily_rates WHERE day=? AND pair=?').bind(day,'VNDKRW').first(); if(cached) return json({day,rate:cached.rate,source:cached.source});
    const res=await fetch('https://open.er-api.com/v6/latest/VND'); const data=await res.json(); const rate=Number(data?.rates?.KRW); if(!res.ok||!rate) throw Object.assign(new Error('환율 정보를 가져오지 못했습니다.'),{status:502}); await env.DB.prepare('INSERT OR REPLACE INTO daily_rates(day,pair,rate,source,fetched_at) VALUES(?,?,?,?,?)').bind(day,'VNDKRW',rate,'open.er-api.com',nowIso()).run(); return json({day,rate,source:'open.er-api.com'});
  }

  if(req.method==='GET'&&p==='/api/weather') {
    await auth(req,env); const lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng')); if(!Number.isFinite(lat)||!Number.isFinite(lng)) throw Object.assign(new Error('위치가 필요합니다.'),{status:400}); const weatherRes=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,weather_code&daily=precipitation_probability_max&timezone=Asia%2FHo_Chi_Minh&forecast_days=1`); const w=await weatherRes.json().catch(()=>({})); const temperature=Number(w.current?.temperature_2m),windSpeed=Number(w.current?.wind_speed_10m); if(!weatherRes.ok||!Number.isFinite(temperature)||!Number.isFinite(windSpeed)) throw Object.assign(new Error('날씨 제공 서버에서 올바른 응답을 받지 못했습니다.'),{status:502}); const code=Number(w.current?.weather_code||0); const summary=code===0?'맑음':code<=3?'구름':code<=67?'비':code<=77?'눈':code<=82?'소나기':'기상 변화'; return json({current:{temperature,windSpeed,weatherCode:code},daily:{precipitationProbability:w.daily?.precipitation_probability_max?.[0]??0},summary});
  }

  return json({error:'Not found'},404);
}

export default { async fetch(req, env, ctx) { const headers=cors(req,env); if(req.method==='OPTIONS') return new Response(null,{status:204,headers}); try { const res=await handle(req,env,ctx); const h=new Headers(res.headers); Object.entries(headers).forEach(([k,v])=>h.set(k,v)); return new Response(res.body,{status:res.status,headers:h}); } catch(err) { const status=err.status||500;if(status>=500)console.error(JSON.stringify({message:'request failed',path:new URL(req.url).pathname,status,error:String(err?.message||err)}));return json({error:err.message||'Server error'},status,headers); } } };
