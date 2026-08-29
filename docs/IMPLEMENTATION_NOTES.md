# Implementation notes

## UI rules
- No emoji in UI.
- Mobile-first, iPhone Safe Area supported.
- No horizontal page scrolling.
- Date/time editing happens in a bottom sheet.
- All grid columns use `minmax(0, 1fr)` where editable content can grow.
- Long Vietnamese place names use `overflow-wrap:anywhere`.
- Touch targets are at least 44px.

## Route behavior
- DRIVE is displayed to users as `차량 / Grab`.
- WALK is displayed simultaneously.
- DRIVE uses the FOSSGIS OSRM car profile and WALK uses its foot profile. Public routes do not include live traffic.
- Route optimization never changes the plan automatically. It returns a suggested order and requires explicit user confirmation.
- Locked places are used as segment boundaries.
- Nominatim and OSRM requests pass through per-service Durable Object gates. Each gate reserves request starts at least 1.1 seconds apart, while the Worker Cache prevents duplicate upstream requests.

## Data design
The family trip state is intentionally stored as one JSON document plus a revision number. This keeps the v1 D1 schema small and makes offline-first development simple. For a larger public service, migrate to normalized itinerary/place/expense tables and operation-based sync.
- Expenses keep the existing flat `state.expenses[]` shape. Schedule-linked expenses add an optional `planItemId`; ordinary expenses keep it `null`, so existing records remain valid.
- Expense totals are calculated from stored VND and KRW values. The `settings.moneyDisplay` value only changes per-row presentation (`compact` or `detail`) and is backward-compatible with older state documents.
- New places store `osmType`, `osmId`, `lat`, `lng`, and `address`. Legacy `placeId` fields remain readable only for backward-compatible Google Maps URL links and are no longer sent to an API.
