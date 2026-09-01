# Family Travel Hub

가족 해외여행을 **한 여행 안에서 함께 계획하고, 현지에서 바로 쓰는 PWA 여행 허브**입니다. 첫 목적지는 베트남 나트랑이지만 도시 데이터는 설정값으로 분리해 다낭 등으로 확장할 수 있습니다.

## 배포 주소

- PWA: https://kangj-collab.github.io/family-travel-hub/
- Cloudflare Worker: https://family-travel-hub-api.efde234.workers.dev
- Worker 상태 확인: https://family-travel-hub-api.efde234.workers.dev/api/health

## 핵심 UX

- 홈은 끝까지 **오늘 일정 중심**입니다. 지도는 앱 안에 상시 표시하지 않습니다.
- 날짜/시간은 카드 안에서 직접 늘어나는 입력칸이 아니라 **Bottom Sheet**에서 편집합니다. `minmax(0, 1fr)`와 `min-width: 0`을 기본으로 사용해 모바일에서 그리드가 깨지지 않게 했습니다.
- 시간은 선택사항이며 체류시간은 받지 않습니다.
- 장소 사이에 **OSRM 차량/Grab 예상시간과 도보 예상시간을 함께 표시**합니다.
- Google Maps는 Maps JavaScript API를 쓰지 않고 **Maps URL로 외부 이동**합니다. 이동 전 안내 모달을 표시합니다.
- 이모지는 사용하지 않습니다. UI 아이콘은 Lucide 선형 아이콘을 사용합니다.
- 테마: 시스템 / 라이트 / 다크 / 아이보리 / 웜 아이보리 + 강조색 5종.
- VND 입력은 `100000`을 입력해도 `100,000`으로 자동 포맷하며 `10만 동`, `약 5,230원`처럼 한국인 기준으로 함께 보여줍니다.

## 포함 기능

- DAY별 일정, 시간 선택 입력, 일정 잠금, 순서 변경
- OpenStreetMap Nominatim 장소 검색 및 좌표 저장
- OSRM 차량/Grab + 도보 이동시간
- 잠금 일정 사이의 동선 추천 후 사용자가 적용
- 가족 공동편집: OWNER / EDITOR / VIEWER
- 사용자가 직접 누를 때만 현재 위치를 가족에게 공유 (24시간 내 공유 위치 표시)
- 회원가입 없이 10분 유효·1회 사용 가족 참여 코드 + 기기 토큰
- IndexedDB 오프라인 일정/즐겨찾기
- 일 1회 환율 캐시 + 환율 계산 + 일반/일정 연결 가계부 지출
- 체크리스트, 예약/문서 메모
- 날씨 요약, Google Maps/Papago/Translate/Grab/Windy/해외안전여행/USGS 바로가기
- PWA 설치 및 Service Worker 캐시

## 구조

```text
GitHub Pages (HTML/CSS/Vanilla JS/PWA)
   ├─ IndexedDB (오프라인)
   ├─ Lucide
   └─ Cloudflare Worker
        ├─ D1 (가족 일정/권한/초대/일일 환율)
        ├─ OpenStreetMap Nominatim (장소 검색)
        ├─ OSRM (차량/도보 경로와 Trip 동선 추천)
        ├─ Durable Object (공개 API 초당 1회 호출 직렬화)
        ├─ 환율 공급자
        └─ Open-Meteo
```

장소는 OSM 객체 식별자와 위도·경도, 사용자가 선택한 이름·주소를 저장합니다. 일부 한국어 업종명과 나트랑의 자주 쓰는 한국어 장소 표기는 Worker에서 OSM 검색어로 변환합니다. OSM에 등록되지 않은 장소는 검색어 그대로 저장하거나 일정에 추가하고 Google Maps 일반 URL로 확인할 수 있습니다. 기존 Google Place ID만 있는 일정은 이동시간 갱신이나 동선 추천을 처음 실행할 때 Nominatim 검색 결과로 좌표를 한 번 보완합니다. 자동 검색에 실패하면 일정 편집에서 OSM 위치를 직접 선택할 수 있습니다.

## 1. GitHub Pages 배포

저장소 루트에 이 파일들을 올리고 GitHub Pages를 `main / root`로 활성화합니다.

## 2. Cloudflare D1 + Worker

```bash
cd worker
npm install
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create family-travel-hub
# 출력된 database_id를 wrangler.toml에 반영
npx wrangler d1 execute family-travel-hub --remote --file=./schema.sql
npx wrangler secret put OWNER_BOOTSTRAP_KEY
npx wrangler deploy
```

Cloudflare Worker 배포 주소는 `js/api.js`의 `WORKER_URL`에 배포 설정으로 고정합니다. 가족 사용자가 앱 화면에서 주소를 입력하거나 변경할 필요는 없습니다. `wrangler.toml`의 `APP_ORIGIN`은 GitHub Pages origin(예: `https://id.github.io`), `APP_BASE_URL`은 실제 저장소 경로까지 포함한 PWA 주소로 설정합니다.

Nominatim과 OSRM은 별도 계정이나 API 키가 필요하지 않습니다. 공개 서버 정책에 맞춰 Worker가 식별 가능한 User-Agent와 출처 정보를 보내고, 동일 결과를 캐시하며, Durable Object로 서비스별 요청 시작 시점을 초당 1회 이하로 직렬화합니다.

## 3. 가족 공유 시작

1. PWA 설정에서 `이 여행을 가족 공유로 만들기`
2. OWNER 설정키 입력 및 기기 토큰 생성
3. 여행 도구 > 가족 > `가족 초대`에서 참여 코드를 생성합니다.
4. 가족은 원하는 Safari 또는 Chrome에서 PWA 주소를 직접 열고 `참여 코드 입력`을 선택합니다.
5. 참여 코드는 10분 동안 한 번만 사용할 수 있으며, 성공하면 해당 기기에 토큰이 발급됩니다.
6. OWNER가 EDITOR / VIEWER 권한을 변경할 수 있습니다.

동일 revision에서 동시에 수정하면 서버가 409를 반환하고 최신 가족 일정을 불러옵니다. v1은 단순하고 예측 가능한 충돌 방식을 우선했습니다.

## API 보안과 공개 서비스 사용량 제한

- 가족 공유 여행 생성은 `OWNER_BOOTSTRAP_KEY` Worker Secret을 아는 OWNER만 할 수 있습니다. 설정키는 생성 요청에만 사용하고 브라우저 저장소에는 보관하지 않습니다.
- 장소 검색, 경로, 환율, 날씨 API는 초대받은 가족 기기 토큰을 요구합니다.
- 공개 장소·경로 API는 가족 구성원별 분당 30회로 제한하고, Nominatim과 OSRM 각각 앱 전체 초당 1회 이하로 직렬화합니다.
- 장소 검색은 사용자 제출 시에만 실행하며 자동완성을 구현하지 않습니다.
- Nominatim 검색 결과는 30일, OSRM 경로 결과는 24시간 Worker Cache에 보관합니다.
- `APP_ORIGIN`으로 허용할 GitHub Pages Origin을 제한합니다.

## 참고: Google Maps 외부 이동

Maps URL은 API 키가 필요 없으며 `api=1` URL을 사용합니다. 앱 내부에서 자체 내비게이션은 제공하지 않습니다.

## 라이선스

프로젝트 자체는 Apache-2.0입니다. Lucide는 ISC 라이선스입니다. 장소·경로 데이터는 `© OpenStreetMap contributors`(ODbL)로 표시하며 OSRM과 각 외부 서비스의 정책을 따릅니다.
