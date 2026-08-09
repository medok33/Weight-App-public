# Pantry feature

FEATURE_ID: PANTRY  
STEP_ID: STEP_176

## UI

Route: `/pantry`  
Screen states: `loading`, `empty`, `error`, `forbidden`, `success`.

## API client

- `GET /api/v1/pantry`
- `POST /api/v1/pantry/items`
- `DELETE /api/v1/pantry/items/:id`

Expiry badges come from API `expiryStatus` (`ok|soon|expired|unknown`).
