# Time Off Service

MyCompany-owned microservice for employee time-off workflow: leave requests, manager approval, balance visibility, HCM sync, and a local balance ledger. HCM (Workday v1) is the source of truth for employment and time-off master data; this service owns the approval workflow.

**API:** JSON:API v1.1 · **Auth:** JWT (HS256) · **Database:** SQLite (dev) via Prisma

Full specification: [`docs/spec.md`](docs/spec.md)

---

## Requirements

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org/) | **≥ 20** |
| npm | 9+ (bundled with Node) |

Optional:

- `curl` or [HTTPie](https://httpie.io/) for manual API calls
- [Prisma Studio](https://www.prisma.io/studio) (`npx prisma studio`) to inspect the database

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Create database and apply schema
npm run db:migrate
npm run db:seed

# 4. Start Workday mock (terminal 1)
npm run mock:workday

# 5. Start API (terminal 2)
npm run dev
```

The API listens on **http://localhost:3000** (see `PORT` in `.env`).  
The Workday mock listens on **http://127.0.0.1:4001**.

---

## Development workflow

### 1. Bootstrap HCM data (first run)

Sync populates employees, leave types, policies, and balances from the Workday mock.

```bash
# Mint a system_admin token
npm run tools:jwt -- --role system_admin

# Trigger sync
curl -X POST http://localhost:3000/api/v1/sync/time-off \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/vnd.api+json"
```

### 2. Mint JWTs for testing

Phase 1 has no login endpoint. Use the CLI tool (reads `JWT_SECRET` from `.env`):

```bash
npm run tools:jwt -- --help
npm run tools:jwt -- --role system_admin
npm run tools:jwt -- --role employee --preset alice
npm run tools:jwt -- --role manager --preset bob
npm run tools:jwt -- --list-employees   # after sync
npm run tools:jwt -- --role employee --preset alice -q   # token only
```

Presets `alice`, `bob`, and `carol` map to mock Workday workers and resolve internal `employeeId` from the database.

**Roles:** `employee` · `manager` · `hr_admin` · `system_admin` · `integration_client`

### 3. Example API call

```bash
TOKEN=$(npm run tools:jwt -- --role employee --preset alice -q)

curl http://localhost:3000/api/v1/leave-types \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.api+json"
```

### 4. Health checks (no auth)

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env`. Key variables:

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | SQLite path (default `file:./dev.db`) |
| `JWT_SECRET` | HS256 signing secret (**required**) |
| `JWT_ISSUER` | Expected token issuer (default `timeoff-service`) |
| `JWT_AUDIENCE` | Expected audience (default `timeoff-api`) |
| `WORKDAY_TENANT_HOSTNAME` | Mock: `127.0.0.1:4001` or `localhost:4001` |
| `HCM_MOCK_MODE` | `true` for local dev (skips real OAuth) |
| `LOG_LEVEL` | Pino log level (default `info`) |

See [`docs/spec.md` §4](docs/spec.md) for the full list including cron schedules.

---

## Database

- **Dev database:** `./dev.db` (project root, gitignored)
- **Schema:** [`prisma/schema.prisma`](prisma/schema.prisma)
- **Migrations:** [`prisma/migrations/`](prisma/migrations/)

```bash
npm run db:migrate    # apply migrations (dev)
npm run db:push       # push schema without migration file
npm run db:seed       # seed holidays
npm run db:generate   # regenerate Prisma client
npx prisma studio     # browse data
```

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled app |
| `npm run mock:workday` | Start Workday Absence Management v5 mock |
| `npm run tools:jwt` | Mint test JWTs ([`bin/tools/create-jwt.ts`](bin/tools/create-jwt.ts)) |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (mock Workday + SQLite) |
| `npm run test:coverage` | Unit tests with coverage |

---

## Project layout

```
timeoff-service/
├── bin/tools/           # CLI utilities (JWT minting)
├── docs/                # spec.md, trd.md, Workday OAS
├── prisma/              # schema, migrations, seed
├── src/
│   ├── app.ts           # Fastify bootstrap
│   ├── routes/v1/       # HTTP routes
│   ├── services/        # Domain logic
│   ├── integrations/hcm/# Workday adapter
│   └── jobs/            # Cron (nightly sync, HCM retry)
├── tests/               # unit + integration
└── tools/workday-mock/  # Local HCM mock server
```

---

## Testing

```bash
npm test                  # unit
npm run test:integration  # end-to-end against mock Workday
npm run test:coverage     # coverage report
```

Integration tests start their own mock server and test database; no manual setup required.

---

## Production notes

Phase 1 targets local development with SQLite and the Workday mock. For production:

- Point `WORKDAY_TENANT_HOSTNAME` and OAuth credentials at a real Workday tenant
- Set `HCM_MOCK_MODE=false`
- Use a strong `JWT_SECRET` and issue tokens from your upstream identity provider
- Migrate from SQLite to PostgreSQL (schema is portable; see spec Phase 3)

---

## Documentation

- [Implementation spec](docs/spec.md) — API, data model, business rules
- [TRD](docs/trd.md) — product requirements
- [Workday OAS](docs/hcm/workday/absenceManagement_v5_20260530_oas2.json) — Absence Management v5 reference
