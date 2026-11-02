# Lahore Rides: ride-booking take-home

A simplified ride-booking application for Lahore. A rider picks a pickup and destination, compares **Economy** and **Comfort** fares and pickup ETAs, requests a ride, and follows its status until it completes or is cancelled. The backend manages ride requests, driver availability, concurrency-safe driver assignment and the ride lifecycle.

**Stack:** Next.js 16 + React 19 (TypeScript) · Fastify 5 (Node.js, TypeScript) · PostgreSQL · Zod · Vitest · Testing Library · Playwright

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture diagram, design notes, answers to the 8 architecture questions, trade-offs |
| [docs/openapi.yaml](docs/openapi.yaml) | OpenAPI 3.1 spec for every endpoint, with examples and error codes |
| [apps/api/migrations/001_initial_schema.sql](apps/api/migrations/001_initial_schema.sql) | Database schema with all integrity constraints |

---

## Quick start

### Prerequisites
- **Node.js 20+** (developed on 24) and npm
- **PostgreSQL 15+** running locally (developed on 17)

Docker is not required. See [Known limitations](#known-limitations).

### 1. Install

```bash
git clone <repo-url> ride-booking
cd ride-booking
npm install
```

### 2. Configure

Create the API's local environment file from the template and set your Postgres password:

```bash
cp apps/api/.env.example apps/api/.env          # PowerShell: Copy-Item apps/api/.env.example apps/api/.env
# then edit apps/api/.env → DATABASE_URL=postgres://postgres:<password>@localhost:5432/ride_booking
```

The web app works without configuration (it defaults to `http://localhost:4000` and the seeded demo rider). To override, copy `apps/web/.env.example` to `apps/web/.env.local`.

`.env` files are git-ignored; only `.env.example` templates are committed.

### 3. Create the database, migrate and seed

```bash
createdb -U postgres ride_booking               # or: CREATE DATABASE ride_booking; in psql / pgAdmin
npm run db:migrate
npm run db:seed
```

The seed adds fare rates, two riders and seven drivers placed around Lahore (five available). Both commands are idempotent and safe to re-run.

### 4. Run

In two terminals:

```bash
npm run dev:api        # API → http://localhost:4000
npm run dev:web        # Web → http://localhost:3000
```

Open **http://localhost:3000** and:
1. Choose a pickup (e.g. *Liberty Market, Gulberg*) and a destination (e.g. *Model Town Park*).
2. Compare fares and ETAs, then **Request** a ride.
3. Use the **Demo controls** panel (it stands in for the driver app) to **Assign nearest driver**, then **Complete trip**. Or **Cancel ride** at any point it is allowed.
4. Reload the page mid-ride: the ride is restored.

---

## Tests

| Command | What runs | Count |
|---|---|---|
| `npm test` | API unit + integration tests, then web component tests | 75 + 26 |
| `npm run test:api` | API only: domain unit tests and integration tests against a real Postgres | 75 |
| `npm run test:web` | Web only: Vitest + Testing Library (loading/error/empty states, retries) | 26 |
| `npm run test:e2e` | Playwright end-to-end in Chromium, desktop and mobile viewports | 10 |
| `npm run typecheck` | TypeScript for both apps | |

**Integration tests** use a separate database, `ride_booking_test`, which they create and migrate automatically (`TEST_DATABASE_URL`, or `DATABASE_URL` with `_test` appended). The runner refuses to touch any database whose name does not end in `_test`, because tests truncate tables.

**End-to-end tests** need Playwright's browser once:

```bash
npx playwright install chromium   # run inside apps/web
npm run test:e2e
```

They reuse API and web servers already running on ports 4000/3000, or start them. They run against the seeded **development** database and cancel the demo rider's active ride before each test.

### Coverage of the required scenarios

| Requirement | Where |
|---|---|
| Successful ride creation | `apps/api/test/integration/rides.test.ts` |
| Invalid input (8 cases + malformed JSON + unknown ids) | `rides.test.ts` |
| Driver availability and assignment | `apps/api/test/integration/matching.test.ts` |
| **Concurrent driver acceptance** (10 drivers → 1 winner; 8 rides × 5 drivers → no double assignment; accept vs cancel race) | `apps/api/test/integration/concurrency.test.ts` |
| Invalid ride-state transitions (every invalid pair, unit and API level, plus a DB-level check) | `apps/api/test/unit/rideStateMachine.test.ts`, `apps/api/test/integration/transitions.test.ts` |
| **Duplicate requests and retries** (replay, 10 simultaneous same-key requests, different keys, key reuse, retry after failure) | `concurrency.test.ts` |
| Frontend loading and error states | `apps/web/src/components/*.test.tsx`, `apps/web/src/lib/api.test.ts` |
| End-to-end | `apps/web/e2e/ride-booking.spec.ts`: full journey, cancel, reload, error recovery, and a dropped response that must not duplicate a ride |

The critical tests were **mutation-checked**: deliberately breaking the ride lock or the idempotency handling (backend), or the retry-key logic (frontend), makes them fail.

---

## API

Full specification: **[docs/openapi.yaml](docs/openapi.yaml)** (paste into [editor.swagger.io](https://editor.swagger.io) to browse).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/fare-estimates` | Quote both categories (fare, distance, nearest-driver ETA) |
| `POST` | `/rides` | Request a ride. **`Idempotency-Key` header required** |
| `GET` | `/rides/{id}` | Ride details, including `allowedActions` |
| `POST` | `/rides/{id}/accept` | Assign a driver: a specific `driverId`, or the nearest eligible driver if omitted |
| `POST` | `/rides/{id}/cancel` | Cancel (rider/driver/system); frees the driver |
| `POST` | `/rides/{id}/complete` | Complete; sets the final fare and frees the driver at the drop-off |
| `GET` | `/riders/{id}/active-ride` | The rider's ride in progress, or `null` |
| `GET` | `/drivers?status=&category=` | List drivers |
| `POST` | `/drivers/{id}/availability` | Driver goes `AVAILABLE` / `OFFLINE` (not while on a trip) |
| `GET` | `/health` | Liveness and DB connectivity |

All errors share one envelope:

```json
{ "error": { "code": "INVALID_STATE_TRANSITION", "message": "Ride cannot move from COMPLETED to CANCELLED",
             "details": { "from": "COMPLETED", "to": "CANCELLED" }, "requestId": "9ae1dde0-…" } }
```

### Example session (bash)

```bash
API=http://localhost:4000
RIDER=00000000-0000-4000-8000-000000000001
TRIP='"pickup":{"address":"Liberty Market","lat":31.5104,"lng":74.3416},"dropoff":{"address":"Model Town Park","lat":31.4834,"lng":74.3256}'

# Quote
curl -s -X POST $API/fare-estimates -H 'Content-Type: application/json' -d "{$TRIP}"

# Request (the same Idempotency-Key can be retried safely)
curl -s -X POST $API/rides -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' \
     -d "{\"riderId\":\"$RIDER\",\"category\":\"ECONOMY\",$TRIP}"

# Assign the nearest driver, then complete
curl -s -X POST $API/rides/<ride-id>/accept   -H 'Content-Type: application/json' -d '{}'
curl -s -X POST $API/rides/<ride-id>/complete -H 'Content-Type: application/json' -d '{}'
```

---

## Project structure

```
ride-booking/
├── apps/
│   ├── api/                         Fastify API
│   │   ├── migrations/              SQL schema (forward-only, applied in order)
│   │   ├── scripts/                 migrate.ts, seed.ts
│   │   ├── src/
│   │   │   ├── domain/              pure rules: state machine, fares, geo
│   │   │   ├── repositories/        all SQL
│   │   │   ├── services/            transactions, matching, idempotency, DTOs
│   │   │   ├── http/                routes and Zod schemas
│   │   │   ├── app.ts               app factory: error handling, CORS, request ids
│   │   │   └── server.ts            entry point, graceful shutdown
│   │   └── test/                    unit/ and integration/
│   └── web/                         Next.js app
│       ├── src/app/                 page, layout, styles
│       ├── src/components/          BookingForm, RideTracker, DriverSimulator, MapPlaceholder…
│       ├── src/lib/                 API client (timeouts, safe retries), types, places
│       └── e2e/                     Playwright tests
└── docs/                            ARCHITECTURE.md, openapi.yaml
```

## Design highlights

Full reasoning is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **Invariants live in the database:** one active ride per rider, one active ride per driver (partial unique indexes), and a `CHECK` that ties each status to a consistent row shape. Application checks give friendly errors; constraints give guarantees.
- **Concurrency:** every transition is one transaction that locks the ride row, then the driver row (one global lock order, so no deadlocks). Updates are compare-and-set. Dispatch uses `FOR UPDATE SKIP LOCKED`.
- **Idempotency:** the key is claimed and the response stored in the same transaction as the change, so a retry after success replays the response and a retry after failure runs again.
- **Explicit lifecycle:** one state-machine table drives validation, and the API returns `allowedActions` so the UI shows only valid buttons.
- **Operational basics:** environment config validated at startup (fails fast, never prints secrets), structured logs with a request id echoed in every error, `/health` with a DB check, graceful shutdown, strict CORS allow-list.

## Known limitations

These are deliberate scope cuts. [ARCHITECTURE.md §8](docs/ARCHITECTURE.md#8-the-three-most-important-improvements-before-production) lists what to do first.

- **No authentication or authorization.** The rider is identified by `riderId` in the request, and accept/complete are open to any caller. The web app acts as one seeded demo rider.
- **No driver app.** A "Demo controls" panel triggers accept/complete. Dispatch is instant, with no offers, timeouts or declines, and a ride can stay `REQUESTED` if no driver is free (there is no expiry job).
- **Simplified geography:** a rectangular Lahore service area; distance is straight-line × 1.3 and ETA assumes 22 km/h; nearby search is an equirectangular formula over all drivers (production: PostGIS / Redis GEO / H3). Places come from a fixed list of 12 landmarks (no geocoding), and the map is a schematic SVG.
- **Final fare equals the quoted fare** (no trip tracking).
- **Polling every 3 s** rather than push. A poll response that was in flight when the rider cancelled can briefly show the previous status until the next poll.
- **Idempotency keys are never purged**; production needs a TTL cleanup job.
- **No rate limiting.**
- **E2E tests use the development database** and leave completed or cancelled test rides behind.
- **No Docker setup.** Docker was not available in the development environment, so rather than ship an untested `docker-compose.yml`, setup uses a local PostgreSQL with the steps above.

## AI tools disclosure

This project was built with **Claude Code** (Anthropic's AI coding assistant, model Claude Opus 5.5), which wrote most of the code and documentation. I directed the work phase by phase (schema → API → backend tests → frontend → frontend and E2E tests → docs), reviewed each phase and the design choices behind it before approving the next, and ran it against my local PostgreSQL.

How the output was verified:
- **Automated tests:** 111 tests (75 API, 26 web component, 10 Playwright E2E across desktop and mobile), all passing, plus TypeScript type-checking for both apps.
- **Mutation checks:** critical safeguards were deliberately broken (ride locking, idempotency handling, retry-key logic) to confirm that the tests fail when the code is wrong.
- **Database-level checks:** invalid rows were inserted directly with SQL to confirm the constraints reject them.
- **Manual testing:** smoke-tested every endpoint against the running API, and reviewed screenshots of the UI on desktop and mobile; a mobile layout issue found this way was fixed.
- **Fresh-clone check:** before submitting, the repository was cloned from GitHub into a new folder and set up against a brand-new database by following this README (install, migrate, seed). All 111 tests passed, and the booking, cancellation, error and no-driver flows were walked through in the browser.
