const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', ...extra } });
const nowIso = () => new Date().toISOString();
const rand = (bytes=24) => { const a=new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
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
async function limitGoogle(me,env){if(!env.GOOGLE_API_RATE_LIMITER)throw Object.assign(new Error('Google API 사용량 제한이 설정되지 않았습니다.'),{status:503});const {success}=await env.GOOGLE_API_RATE_LIMITER.limit({key:`member:${me.member_id}`});if(!success)throw Object.assign(new Error('Google API 요청이 너무 많습니다. 잠시 후 다시 시도하세요.'),{status:429});}
function routeWaypoint(input){ if(input?.placeId) return {placeId:input.placeId}; if(Number.isFinite(input?.lat)&&Number.isFinite(input?.lng)) return {location:{latLng:{latitude:input.lat,longitude:input.lng}}}; throw Object.assign(new Error('유효한 위치가 필요합니다.'),{status:400}); }

async function googleFetch(env, path, body, fieldMask) {
  if(!env.GOOGLE_MAPS_API_KEY) throw Object.assign(new Error('GOOGLE_MAPS_API_KEY Worker Secret이 설정되지 않았습니다.'),{status:503});
  const res=await fetch(`https://routes.googleapis.com/${path}`,{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':fieldMask},body:JSON.stringify(body)});
  const data=await res.json(); if(!res.ok) throw Object.assign(new Error(data?.error?.message||'Google Routes 요청 실패'),{status:502}); return data;
}

async function handle(req, env) {
  const url=new URL(req.url), p=url.pathname;
  if(req.method==='GET'&&p==='/api/health') return json({ok:true,version:'1.3.0'});

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
    const code=rand(24), hash=await sha256(code), expires=new Date(Date.now()+24*60*60*1000).toISOString();
    await env.DB.prepare('INSERT INTO invites(id,trip_id,code_hash,role,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),me.trip_id,hash,role,expires,nowIso()).run();
    const base=(env.APP_BASE_URL||env.APP_ORIGIN||new URL(req.url).origin).split(',')[0].replace(/\/$/,''); return json({inviteUrl:`${base}/?invite=${encodeURIComponent(code)}`,expiresAt:expires});
  }

  if(req.method==='POST'&&p==='/api/invites/join') {
    const {code,name}=await req.json(); const hash=await sha256(String(code||'')); const inv=await env.DB.prepare('SELECT * FROM invites WHERE code_hash=? AND used_at IS NULL AND expires_at>?').bind(hash,nowIso()).first(); if(!inv) throw Object.assign(new Error('초대 링크가 만료되었거나 이미 사용되었습니다.'),{status:400});
    const memberId=crypto.randomUUID(), token=rand(32), tokenHash=await sha256(token); const trip=await env.DB.prepare('SELECT state_json,revision FROM trips WHERE id=?').bind(inv.trip_id).first();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO members(id,trip_id,name,role,created_at) VALUES(?,?,?,?,?)').bind(memberId,inv.trip_id,String(name||'가족').slice(0,40),inv.role,nowIso()),
      env.DB.prepare('INSERT INTO device_tokens(id,member_id,token_hash,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),memberId,tokenHash,nowIso()),
      env.DB.prepare('UPDATE invites SET used_at=? WHERE id=?').bind(nowIso(),inv.id)
    ]);
    const members=await env.DB.prepare('SELECT id,name,role,created_at FROM members WHERE trip_id=? ORDER BY created_at').bind(inv.trip_id).all(); return json({tripId:inv.trip_id,memberId,token,role:inv.role,state:JSON.parse(trip.state_json),revision:trip.revision,members:members.results});
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
    const me=await auth(req,env); await limitGoogle(me,env); if(!env.GOOGLE_MAPS_API_KEY) throw Object.assign(new Error('GOOGLE_MAPS_API_KEY Worker Secret이 설정되지 않았습니다.'),{status:503}); const q=(url.searchParams.get('q')||'').trim(); if(!q) return json({places:[]});
    const res=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress'},body:JSON.stringify({textQuery:q,languageCode:'ko',regionCode:'VN',locationBias:{circle:{center:{latitude:12.2388,longitude:109.1967},radius:50000}}})}); const data=await res.json(); if(!res.ok) throw Object.assign(new Error(data?.error?.message||'Google Places 검색 실패'),{status:502});
    return json({places:(data.places||[]).slice(0,12).map(x=>({id:x.id,name:x.displayName?.text||'',address:x.formattedAddress||''}))});
  }

  if(req.method==='POST'&&p==='/api/routes') {
    const me=await auth(req,env); await limitGoogle(me,env); const {origin,destination,mode='DRIVE'}=await req.json(); if(!['DRIVE','WALK'].includes(mode)) throw Object.assign(new Error('지원하지 않는 이동수단입니다.'),{status:400});
    const routeBody={origin:routeWaypoint(origin),destination:routeWaypoint(destination),travelMode:mode,languageCode:'ko-KR',units:'METRIC'}; if(mode==='DRIVE') routeBody.routingPreference='TRAFFIC_AWARE'; const data=await googleFetch(env,'directions/v2:computeRoutes',routeBody,'routes.duration,routes.distanceMeters'); const r=data.routes?.[0]; return json({durationSeconds:parseFloat(String(r?.duration||'0').replace('s','')),distanceMeters:r?.distanceMeters||0,warning:mode==='WALK'?'도보 경로는 베타 기능으로 실제 보행로와 다를 수 있습니다.':null});
  }

  if(req.method==='POST'&&p==='/api/routes/optimize') {
    const me=await auth(req,env); await limitGoogle(me,env); const {items=[]}=await req.json();
    if(!Array.isArray(items)||items.some(item=>!item?.id||!item?.placeId)) throw Object.assign(new Error('최적화할 장소 정보가 올바르지 않습니다.'),{status:400});
    if(items.length<3) return json({order:items.map(i=>i.id)});
    // 잠긴 장소를 경계로 구간을 나눈다. 각 구간의 시작/끝은 고정하고 중간 항목만 Google Routes가 최적화한다.
    let order=items.map(i=>i.id); const lockedIdx=items.map((x,i)=>x.locked?i:-1).filter(i=>i>=0); const boundaries=[0,...lockedIdx.filter(i=>i>0&&i<items.length-1),items.length-1].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
    for(let b=0;b<boundaries.length-1;b++) { const s=boundaries[b],e=boundaries[b+1]; if(e-s<2) continue; const segment=items.slice(s,e+1), mids=segment.slice(1,-1); if(mids.length<2) continue;
      const data=await googleFetch(env,'directions/v2:computeRoutes',{origin:{placeId:segment[0].placeId},destination:{placeId:segment.at(-1).placeId},intermediates:mids.map(x=>({placeId:x.placeId})),travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE',optimizeWaypointOrder:true,languageCode:'ko-KR',units:'METRIC'},'routes.optimizedIntermediateWaypointIndex,routes.duration,routes.distanceMeters');
      const candidate=data.routes?.[0]?.optimizedIntermediateWaypointIndex;
      const valid=Array.isArray(candidate)&&candidate.length===mids.length&&new Set(candidate).size===mids.length&&candidate.every(i=>Number.isInteger(i)&&i>=0&&i<mids.length);
      const idx=valid?candidate:mids.map((_,i)=>i); const segOrder=[segment[0].id,...idx.map(i=>mids[i].id),segment.at(-1).id]; order.splice(s,segment.length,...segOrder);
    }
    return json({order});
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

export default { async fetch(req, env) { const headers=cors(req,env); if(req.method==='OPTIONS') return new Response(null,{status:204,headers}); try { const res=await handle(req,env); const h=new Headers(res.headers); Object.entries(headers).forEach(([k,v])=>h.set(k,v)); return new Response(res.body,{status:res.status,headers:h}); } catch(err) { return json({error:err.message||'Server error'},err.status||500,headers); } } };
