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
- Google states WALK routes are beta and may not always include clear pedestrian paths; Worker returns a warning field that can be surfaced later.
- Route optimization never changes the plan automatically. It returns a suggested order and requires explicit user confirmation.
- Locked places are used as segment boundaries.

## Data design
The family trip state is intentionally stored as one JSON document plus a revision number. This keeps the v1 D1 schema small and makes offline-first development simple. For a larger public service, migrate to normalized itinerary/place/expense tables and operation-based sync.
