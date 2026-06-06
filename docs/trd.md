Here is the **updated TRD** with your requested changes applied:
- **Response schema follows JSON:API v1.1**
- **Tech stack fixed to Node.js/TypeScript + Fastify + Prisma + SQLite (dev) + JWT + cron**
- **Architecture decision on minimal local HCM copy documented in §5.1**

# Technical Requirements Document (TRD)
## Project: Time Off Management Microservice

**Product owner:** MyCompany

## 1. Overview
The Time Off Management Microservice is a **MyCompany-owned** standalone backend service that provides the **employee-facing interface for time-off operations**—leave requests, approvals, and balance visibility—while integrating with a customer's external Human Capital Management (HCM) system for authoritative HR and time-off data.

MyCompany builds, deploys, and operates this microservice as part of the MyCompany platform. Upstream MyCompany applications (and authorized customer integrations) consume its API; they do not replace it as the time-off workflow boundary. When this document refers to system behavior, **the microservice** is the actor unless explicitly describing MyCompany product or organizational ownership.

Employees and managers interact with time off **through this microservice** (via MyCompany API clients or other upstream applications), not directly through the HCM platform. The HCM system (e.g. Workday, SAP SuccessFactors) remains the **source of truth** for:
- **Employment data** — employee identity, manager hierarchy, department, location, employment type, employment status, hire/termination dates
- **Time-off master data** — leave balances, accrual, carryover, leave types, leave policies, eligibility rules, and balance ledger history

The microservice is exposed through a REST API. It maintains its **own local database** for:
- **Workflow state** — leave requests, approvals, audit
- **Minimal HCM employee records** — internal identifier ↔ HCM employee ID, plus **manager**, **department**, **employment status**, and **email** refreshed nightly (no full employment replica)
- **Locally synced time-off data** — leave types, policies, balances, and related reference data refreshed by a **nightly batch sync** from HCM; validation and display decisions use this local snapshot between syncs
- **Pending balance overlay** — in-flight requests not yet reflected in HCM or the local snapshot

The microservice maintains a **deliberately minimal local copy** of HCM data, defined in **§5.1**. In summary: nightly-synced **employee snapshot** (mapping, manager, department, employment status, **email**) + **time-off working copy** (types, policies, balances); workflow state owned locally; request-time HCM API used for **time-off mutations only**.

The service must support local development using SQLite and be designed for future migration to a production-grade relational database if needed.

### System Boundary

| Concern | System of Record | Local Copy | Employee Interaction |
|---|---|---|---|
| Submitting and tracking leave requests | Time Off Microservice | Workflow state | Through the microservice |
| Approval workflow | Time Off Microservice | Workflow state | Through the microservice |
| Viewing leave balances and policies | HCM | Nightly-synced time-off snapshot | Through the microservice |
| Leave balances, accrual, carryover, policies | HCM | Nightly-synced time-off snapshot | Managed in HCM |
| Employment identity (name, phone, etc.) | HCM | Not stored | HCM or upstream when needed |
| Email | HCM | Nightly-synced on employee record | Microservice (notifications) |
| Manager, department, employment status | HCM | Nightly-synced snapshot | Through the microservice |

The microservice **does not** replace HCM for HR, employment lifecycle, or authoritative time-off accounting. It **does** own the employee-facing request and approval workflow experience.

---

## 2. Goals
- Provide the dedicated **employee interface** for requesting and managing time off.
- Integrate with HCM (e.g. Workday, SAP) as the authoritative **source of truth for employment and time-off master data** (balances, accrual, policies, leave types).
- Maintain a **minimal local employee record** (HCM ID mapping + manager, department, employment status, **email**) plus a **nightly-synced time-off working copy** for workflow decisions.
- Invoke the **HCM realtime API on each leave request operation** to **update HCM time-off data** (not to re-fetch employment snapshot fields stored locally).
- Expose secure REST APIs for employees, managers, and HR administrators.
- Use JSON:API v1.1 compliant request/response structures where applicable.
- Support independent deployment and background job execution.
- Keep persistence and domain design portable beyond SQLite.

---

## 3. Architecture Summary
The service consists of:
- **REST API layer**
- **Business/domain service layer**
- **Persistence layer**
- **HCM integration layer**
- **Authentication/authorization layer**
- **Background job scheduler**
- **Audit and notification layer**

### System Responsibilities

#### HCM system (e.g. Workday, SAP SuccessFactors)
Owns (source of truth for **employment and time-off master data**):
- Employee master data
- Employment status
- Manager hierarchy
- Department and location attributes
- Core HR identity attributes
- Leave types and leave policies
- Leave balances and balance ledger
- Accrual, carryover, expiration, and eligibility rules
- Authoritative time-off accounting

Does **not** own employee time-off **request and approval workflows** in this architecture (those run in the microservice).

#### Time Off Microservice
Owns (employee-facing **workflow interface**):
- Leave requests (creation, submission, cancellation)
- Approval workflow state and approver actions
- Audit logs for workflow actions
- Sync metadata
- Notification records
- **Minimal HCM employee records** (internal ID, HCM employee ID, manager, department, employment status, **email**—updated nightly)
- **Locally synced time-off data** (from nightly HCM batch sync)—balances, leave types, policies, and related fields needed for validation and display
- Local **pending balance overlay** for in-flight requests

---

## 4. Scope

### In Scope
- REST API as the **employee interface** for time-off requests, approvals, and balance visibility
- JSON:API v1.1 compliant responses
- Minimal HCM employee records (mapping + manager, department, employment status, **email**)—no full employment replica
- **Nightly batch sync** of employment snapshot fields and time-off data from HCM into the local working copy
- Leave requests and approvals (workflow owned and executed in the microservice)
- Balance and policy validation using **locally synced time-off data** plus pending overlay
- **Request-time HCM realtime API** calls to read context and update HCM on each leave request operation
- Audit logging
- Background jobs using cron (nightly sync)
- JWT-based authentication

### Out of Scope
- Payroll processing
- Full employee lifecycle management (remains in HCM)
- Local replica of full HCM employment master data (name, phone, hire/termination dates, full org tree, etc.)
- Authoritative leave balance, accrual, or policy management (remains in HCM)
- Benefits administration
- UI/frontend implementation (clients consume the microservice API)
- Replacing HCM as source of truth for employment or time-off accounting data

---

## 5. Key Design Principles
- **MyCompany owns this microservice**—MyCompany builds, deploys, and operates it; upstream MyCompany products consume its API for time-off workflow.
- **The microservice is the employee interface for time off**—requests, approvals, and balance visibility are initiated and tracked here.
- **HCM is authoritative for employment and time-off master data** (Workday, SAP, and similar platforms remain the system of record for balances, accrual, policies, and ledger history).
- **The microservice owns workflow state** (leave requests, approvals, notifications)—not authoritative time-off accounting.
- **API-first design** with JSON:API v1.1 compliance.
- **Loose coupling** between HCM integration and domain logic.
- **Database portability** despite SQLite in development.
- **Minimize local HCM data**—store employee HCM ID mapping, **manager**, **department**, **employment status**, **email** (for notifications), and time-off fields required for sync; no full employment replica.
- **Nightly time-off sync**—refresh the local time-off working copy from HCM; use it for validation and display between sync runs.
- **Request-time HCM integration**—on each leave request operation (submit, approve, reject, cancel), call the HCM realtime API to update HCM and obtain fresh authoritative context where needed.
- **Balance validation uses locally synced time-off data** plus a local pending overlay for in-flight requests.
- **Operational resilience** during temporary HCM outages—workflow and last nightly-synced time-off snapshot remain available locally; new HCM updates are blocked until HCM recovers.
- **Defensive validation** before HCM posting—do not rely solely on HCM to reject invalid requests.
- **Expect external HCM changes**—balances may change outside the microservice (work anniversaries, year-start refreshes, other integrations).

---

## 5.1 Architecture Decision: Minimal Local HCM Copy

**Decision (v1):** The microservice stores a **two-layer local working copy** refreshed **nightly** from HCM, plus **workflow-only** state it owns. HCM remains the system of record for all HCM-owned fields.

### What is stored locally

| Layer | Stored locally | Refresh | Purpose |
|---|---|---|---|
| **A. Employee snapshot** | Internal UUID, HCM `external_employee_id`, `email`, `manager_external_employee_id`, resolved `manager_id`, `department`, `employment_status`, sync metadata | Nightly batch | Eligibility, approval routing, **notification delivery**, mapping time-off rows to employees—**without per-request HCM employment API calls** |
| **B. Time-off working copy** | Leave types, policies/rules, dimensional balances, ledger rows (when included in batch) | Nightly batch | Balance display, defensive validation, policy checks between sync runs |
| **C. Workflow overlay** | Leave requests, approvals, pending balance overlay, audit logs, notifications | Microservice (realtime) | Employee-facing workflow; pending reservations until HCM confirms |
| **D. Request-time HCM** | Nothing persisted beyond workflow/HCM reference IDs | Each submit/approve/reject/cancel | Post or reverse time-off in HCM via realtime API |

### Employee snapshot field dictionary (Layer A)

The minimal employee record stores **only** the following fields. Any field not listed here is out of scope for the local copy (see *What is explicitly not stored locally*).

| Field | Type | Source | Nullable | Classification | Notes |
|---|---|---|---|---|---|
| `id` | UUID | Microservice | No | Internal | Stable internal PK; never changes across syncs |
| `external_employee_id` | string | HCM | No | Internal ID | Natural key for upsert; unique |
| `email` | string | HCM | No | **PII (contact)** | Only contact PII stored; used for notifications only |
| `manager_external_employee_id` | string | HCM | Yes | Internal ID | Raw manager pointer from HCM batch |
| `manager_id` | UUID (FK) | Derived | Yes | Internal | Resolved nightly from `manager_external_employee_id` |
| `department` | string | HCM | Yes | Org attribute | Approval routing / eligibility |
| `employment_status` | enum | HCM | No | Org attribute | `active` / `inactive` / `terminated` / `on_leave` |
| `sync_correlation_key` | string | HCM | Yes | Internal | Optional batch correlation key |
| `last_synced_at` | timestamp | Microservice | No | Internal | Snapshot freshness; drives staleness checks |

### What is explicitly not stored locally

| Not stored | Reason |
|---|---|
| Name, phone | Display contact data not required for v1 workflow or notifications; reduces local PII beyond email |
| Hire/termination dates, employment type, location on employee record | Not required for v1 workflow paths; location handled via **filing dimensions** on leave requests; eligibility driven by synced policy + balance dimensions |
| Full org hierarchy | Manager FK on employee snapshot is sufficient for single-step manager approval; deeper chains use synced policy rules |
| Authoritative balances or accrual logic | HCM computes accounting; local copy is a snapshot only |

### Data classification and PII

- The only contact PII stored locally is **`email`**. Name, phone, and other directory attributes remain in HCM and are fetched from HCM or upstream applications when display is required.
- `email` must be encrypted at rest where the datastore supports it and must **never** appear in application logs, error payloads, or audit `before`/`after` snapshots.
- `department` and `employment_status` are organizational attributes, not sensitive PII, but remain access-controlled by role.
- No payroll, compensation, national identifier, or special-category data is stored locally.
- Snapshot fields are exposed in API responses only to authorized roles (self, reporting-chain manager, HR admin) and annotated with `lastSyncedAt` in `meta` so consumers understand freshness.

### Retention and deletion

The employee snapshot is a **derived cache**, not a system of record; it carries no independent retention obligation beyond active workflow needs.

- **Departed/off-boarded employees** — when an employee no longer appears in a nightly batch, the local record is **not hard-deleted** while it is still referenced by retained workflow or audit records. Instead the record is marked inactive (retaining last-known `employment_status` or a missing-from-sync flag) and excluded from new requests and approver selection.
- **Unreferenced records** — records with no referencing workflow or audit data may be purged after a configurable grace period.
- **Right-to-erasure** — on a verified erasure request, `email` (the only PII field) may be redacted in place while preserving non-PII workflow linkage, subject to MyCompany data-retention policy.
- **Audit linkage** — terminated employees retained solely for audit must not be selectable as requesters or approvers.

### Rationale for this decision

1. **HCM stays authoritative** — The microservice is a workflow boundary, not an HR system of record. Local data is a **working snapshot**, not a competing master database.
2. **Nightly sync matches HCM batch integration** — HCM exposes a batch corpus endpoint; one nightly job updates both employment snapshot and time-off data efficiently.
3. **Avoid per-request employment reads** — Manager, department, employment status, and **email** are needed for workflow and notifications; storing them locally removes latency, rate-limit risk, and hard dependency on HCM employment APIs for read-heavy paths.
4. **Request-time HCM scoped to time-off mutations** — Submit/approve/cancel must write to HCM in near realtime; employment snapshot changes rarely within a workday relative to time-off operations, so nightly refresh is an acceptable tradeoff for v1.
5. **Defensive validation without full replica** — Locally synced balances + pending overlay allow rejecting bad requests before HCM calls, even when HCM error responses are unreliable.
6. **Multi-writer HCM** — Other systems update HCM balances and employment data; a full local replica would drift faster and imply false authority. A minimal snapshot is easier to reconcile nightly.
7. **Security and compliance** — Store only **email** as contact PII locally (required for notifications); name and other HR attributes remain in HCM. Protect email at rest and in transit per MyCompany security policy.
8. **Operational resilience** — During HCM outages, employees can still view last-synced balances and in-flight workflow; only new HCM posts are blocked.

### Risks of this decision

| Risk | Description | Mitigation |
|---|---|---|
| **Stale manager** | Approver may be wrong for up to ~24h after an HCM org change | Nightly sync; optional manual `POST /sync/time-off`; audit approval actions; consider intraday sync in v2 if needed |
| **Stale employment status** | Terminated or inactive employee may pass local active check until next sync | Defensive HCM error handling on submit; optional pre-submit spot check for high-risk tenants; shorten sync interval if incidents occur |
| **Stale balances** | Anniversary accrual, year-start refresh, or other HCM writers change balances without microservice knowledge | Nightly batch reconciliation; pending overlay; request-time HCM response updates affected balance row; reconciliation job |
| **Stale department** | Policy or routing by department may be wrong until next sync | Same as stale manager; department exposed with `lastSyncedAt` in API meta where useful |
| **Missing new employee** | Employee absent from last nightly batch cannot request leave until mapped | Lazy mapping on first request if HCM realtime accepts; ensure batch includes active workforce; clear `NOT_FOUND` errors |
| **Stale email** | Notification may be sent to an outdated address until next nightly sync | Nightly sync; validate email format on ingest; log notification delivery failures; consider intraday sync if bounce rates are high |
| **Unresolved manager FK** | Manager not yet in local table breaks approval routing | Nightly sync resolves FKs in dependency order; fallback to `manager_external_employee_id` + HCM reference in approval payload |
| **24h max drift** | All snapshot layers may lag HCM by one sync cycle | Accept for v1; monitor sync failures and staleness metrics; escalate to alternate options below if SLAs require fresher data |
| **Orphaned/terminated record** | Employee removed from HCM batch but still referenced by workflow or audit records | Mark inactive instead of hard delete; exclude from new requests/approvals; purge only when unreferenced after grace period (see *Retention and deletion*) |
| **PII handling (email)** | `email` is regulated contact PII held locally | Encrypt at rest, exclude from logs/audit snapshots, support in-place redaction for erasure requests |

### Alternate options considered

| Option | Summary | Why not chosen (v1) | When to reconsider |
|---|---|---|---|
| **A. No local HCM data** | Every request reads employment + time-off from HCM realtime API | High latency, rate limits, poor resilience, HCM hard dependency on all reads | Never for workflow-heavy service; only for thin proxy prototypes |
| **B. Full employment replica** | Sync name, email, hierarchy, dates, location, type, etc. nightly | Duplicates HCM HR domain, increases PII scope, reconciliation burden, implies false ownership | Rich HR features, offline employee directory, or reporting without HCM |
| **C. Employment realtime + time-off nightly** | Balances nightly; manager/status fetched from HCM on each request | Doubles HCM integration complexity and failure modes; inconsistent freshness model | Frequent intraday org changes with strict approver accuracy SLAs |
| **D. Intraday delta sync (e.g. every 1–4h)** | Same minimal copy as decided, but more frequent batch runs | Extra HCM load and job orchestration without v1 proven need | Production incidents from nightly staleness; large tenants with heavy external HCM writers |
| **E. Time-off only (mapping ID, no employment snapshot)** | Only HCM ID + balances/types locally; employment from HCM per request | Reintroduces per-request employment API calls the product explicitly avoided | If manager/status/department prove unused in workflow metrics |
| **F. Extended snapshot (+ name, location, employment type)** | Current decision plus additional display/eligibility fields | Name and extra HR fields not required for v1; **email already included** for notifications | MyCompany UI requires display names from microservice without upstream enrichment; location-based eligibility without request dimensions |
| **G. HCM webhook-driven refresh** | Nightly baseline + push updates on HCM changes | Webhook reliability, ordering, and tenant variance add complexity | HCM supports stable change events and 24h lag is unacceptable for balances or org data |

**Selected approach:** **Minimal employee snapshot (including email) + nightly time-off working copy + request-time HCM for time-off mutations** — balances workflow autonomy, notifications, defensive validation, integration practicality, and minimal duplication of HCM.

---

## 6. Functional Requirements

## 6.1 HCM Employee Records (Minimal Local Snapshot)
Implements **§5.1 Layer A**. The service must maintain a **minimal local employee record** per HCM employee. It must **not** replicate full HCM employment master data.

### Requirements
- The service must store, per employee, and refresh **nightly from HCM**:
  - internal identifier (UUID)
  - HCM `external_employee_id`
  - **email** — work email from HCM, used for workflow and approval **notifications**
  - **manager** — `manager_external_employee_id` and/or resolved local `manager_id` (FK to another employee record)
  - **department**
  - **employment status** (e.g. active, inactive, terminated, on leave)
  - sync correlation keys if required by HCM batch payloads
  - `last_synced_at` for employment snapshot fields
- New records may be created when:
  - an employee first appears in a nightly sync payload, or
  - a leave request references an HCM employee ID not yet mapped
- Employment snapshot fields (**email**, **manager**, **department**, **employment status**) are **read-only locally**; they are overwritten on each nightly sync from HCM.
- When an employee no longer appears in a nightly batch, the local record must be **retained, not hard-deleted**, while referenced by workflow or audit records; mark it inactive and exclude it from new requests and approver selection (see **§5.1 Retention and deletion**).
- The microservice must **not** call the HCM employment API on each time-off request solely to obtain email, manager, department, or employment status; it must use the nightly-synced local values for validation, approval routing, and notifications.
- Attributes outside this snapshot (see **§5.1** for excluded fields: name, phone, hire date, location on employee record, employment type, etc.) are **not** stored locally unless the architecture decision is revised.

---

## 6.2 Nightly Sync (Employment Snapshot + Time-Off Data)
Implements **§5.1 Layers A and B**. The service must run a **nightly batch sync** from HCM that updates:
1. **Minimal employment snapshot fields** on each local employee record (email, manager, department, employment status)
2. The microservice's **local time-off working copy** (types, policies, balances, ledger when provided)

Workflow validation, approval routing, balance display, and policy checks between sync runs must be based on this local data (plus the pending overlay defined in §6.4).

Accrual, carryover, expiration, and balance adjustments are performed in HCM—not computed locally.

**Multi-writer HCM:** The microservice is not the only system that writes to HCM. Balances may change due to work anniversary accrual, year-start refresh, HR adjustments, or other integrations without microservice action. The nightly sync reconciles the local working copy with HCM's current state.

### Requirements
- Sync schedule: **once nightly** (configurable cron, default off-peak UTC).
- The nightly job must import and upsert:
  - **employment snapshot fields** per employee: email, manager, department, employment status (and resolve `manager_id` from synced manager external IDs where possible)
  - leave types
  - leave policies and policy rules needed for validation/display
  - current leave balances per mapped employee, leave type, and **HCM dimensions** (e.g. `locationId`)
  - balance ledger / transaction history **when included in the HCM batch payload**
  - employee HCM IDs required to create or refresh employee records
- The service must integrate with the HCM **batch** endpoint that provides the employment snapshot and time-off corpus (full or incremental) with dimensional keys.
- On each nightly run:
  1. Pull batch payload from HCM.
  2. Upsert employee records (mapping + email, manager, department, employment status) for all employees in the batch.
  3. Resolve manager FK references among synced employee records.
  4. Replace/update local time-off rows from the batch payload.
  5. Preserve local pending balance overlay (§6.4).
  6. Record sync metadata and audit the run.
- Synchronization must be idempotent.
- The service must log externally originated balance changes detected when batch values differ from the previous local snapshot without a corresponding workflow event.
- Manual/on-demand batch sync may be supported for operations (`POST /api/v1/sync/time-off`) but must not replace the nightly schedule as the primary refresh mechanism.

---

## 6.3 Leave Policy and Leave Type Reference
Leave types and policies are **defined and managed in HCM**. The microservice stores them in the **nightly-synced time-off working copy** for validation and display between sync runs.

### Requirements
- Leave types and policies must be available locally from nightly sync for:
  - eligibility checks on leave requests
  - approval routing configuration (where provided in synced policy rules)
  - employee balance and policy visibility through the microservice API
- Admin users must **not** authoritatively create or modify leave types or accrual/policy rules through the microservice; changes are made in HCM and reflected in the next nightly sync.
- Between nightly syncs, decisions use the last synced policy snapshot; request-time HCM API calls may supplement for critical checks.

---

## 6.4 Leave Balance Management
The service must maintain a **locally synced time-off working copy** of HCM balances (refreshed nightly) plus a local **pending balance overlay** for in-flight leave requests.

### Requirements
- The service must store nightly-synced balances per mapped employee, leave type, and HCM dimensions.
- Ledger/history rows are stored locally **only when provided by the nightly batch payload**; the microservice does not authoritatively append ledger entries.
- The service must expose:
  - current balance (from nightly-synced local data)
  - pending balance (local overlay for PENDING requests)
  - projected / available balance (`currentBalance - pendingBalance`, adjusted by synced policy rules)
- The service must **not** authoritatively post accrual, carryover, expiration, or manual adjustment entries locally; those originate in HCM and appear in subsequent nightly syncs.
- Balance reads for API responses use the local working copy; `lastSyncedAt` / nightly sync metadata must be exposed where relevant.
- The local working copy is **eventually consistent** with HCM until the next nightly sync or a successful request-time HCM update.
- The service must support **dimensional balances** as returned by HCM (e.g. amount scoped by `employeeId`, leave type, `locationId`, and other HCM dimensions).

---

## 6.5 Leave Request Workflow
Employees request time off **through the microservice**, not through HCM. The service is the system of record for **leave request workflow** and its lifecycle.

**Request-time HCM integration:** On **each leave request operation** (submit, approve, reject, cancel), the microservice must call the **HCM realtime API** to update HCM time-off information and obtain authoritative responses. Local workflow state and the nightly-synced working copy are updated accordingly after successful HCM interaction.

- Employees and authorized delegates must be able to create and submit leave requests through the REST API.
- Requests must include:
  - employee identifier (internal or HCM ID mapped locally)
  - leave type identifier
  - start date
  - end date
  - partial-day option if applicable
  - filing dimensions (e.g. `locationId`) when required by HCM
  - reason/comment
- **On submit:** validate defensively against the local time-off working copy + pending overlay; call HCM realtime API to file/register the time-off request in HCM; persist workflow state and HCM reference on success.
- **On approve / reject / cancel:** update workflow state and call HCM realtime API to confirm, post final usage, or reverse/cancel the HCM time-off entry as appropriate.
- The service must validate **defensively before each HCM call** using:
  - locally synced time-off data (from last nightly sync)
  - local pending balance overlay
  - optional fresh data returned by the HCM realtime API during the same request
- Validation checks include:
  - employee record exists and **employment status** is active (from nightly-synced local snapshot)
  - leave type exists and is eligible (per synced policy)
  - request dimensions match a valid balance row in the local working copy
  - sufficient available balance if required
  - valid date range and no overlapping conflicting requests
  - policy compliance
- HCM may return errors for invalid dimension combinations or insufficient balance, but **this is not guaranteed**; local defensive checks must run first.
- Request-time HCM realtime calls are for **time-off updates only** (file, approve, cancel)—not for fetching manager, department, or employment status on each request.

### Leave Request States
- draft (optional)
- pending
- approved
- rejected
- cancelled

---

## 6.6 Approval Workflow
- Approver resolution must use the **nightly-synced manager** on the employee record (and synced policy rules)—not a per-request HCM employment API call.
- Synced policy rules from the nightly time-off working copy may define additional approval routing where HCM provides them.
- The service must support:
  - single-step approval
  - multi-step approval
  - HR approval for selected leave types
  - auto-approval for configured scenarios
- Each approval action must capture:
  - approver identifier
  - level
  - decision
  - comment
  - timestamp

---

## 6.7 Notifications
The service should generate internal notification events for:
- request submitted
- request approved
- request rejected
- request cancelled
- overdue approvals
- low balance warnings
- sync failures

**Recipient email** must be resolved from the **nightly-synced `email`** on the relevant employee record (requester, approver, or manager). The microservice must not call HCM solely to obtain notification email addresses at send time.

Notification delivery may be implemented internally or delegated to downstream services; downstream handlers receive the resolved email from the microservice.

---

## 6.8 Reporting
The service must expose reports for:
- leave balances (from nightly-synced local time-off data, with pending overlay)
- leave usage
- pending approvals
- team calendar
- audit exports
- synchronization health (nightly time-off sync)

---

## 6.9 Audit Logging
The system must store audit records for:
- leave request creation
- leave request update
- leave request cancellation
- approval/rejection
- HCM realtime API interactions on leave request operations
- nightly time-off sync operations
- administrative security-sensitive actions

Balance adjustments and accrual changes are audited in HCM; the microservice audits workflow actions and sync events.

---

## 7. Non-Functional Requirements

### 7.1 Performance
- Most read endpoints should respond within 500 ms under normal load.
- Most write endpoints should respond within 1 second under normal load.
- Reporting endpoints should respond within 2–5 seconds for common workloads.
- HCM synchronization may run asynchronously.

### 7.2 Availability
- Target service uptime: 99.9%.
- Temporary HCM unavailability must not prevent access to workflow state and the **last nightly-synced** local time-off working copy; new HCM updates via request-time API are blocked until HCM recovers.

### 7.3 Reliability
- Sync operations must be retryable and idempotent.
- Domain writes must be transactional.
- Approval state changes and HCM posting must be atomic where coupled.
- Cron-driven jobs must log execution outcome and failures.

### 7.4 Security
- All protected endpoints must require JWT authentication.
- Authorization must be role-based.
- TLS must be used in transit.
- Sensitive and personally identifiable data must be protected appropriately; **email** stored on employee records must be encrypted at rest where supported and must not appear in application logs.
- Audit trails must be retained for compliance and debugging.

### 7.5 Maintainability
- HCM integration logic must be isolated from domain logic.
- Prisma usage must be abstracted behind repository/service layers where practical.
- Fastify route handlers should remain thin, delegating business logic to services.

### 7.6 Portability
- SQLite is used for development.
- Schema and query patterns should remain compatible with future migration to PostgreSQL or another relational database.

---

## 8. Data Ownership Model

Employment and time-off master data are owned by HCM. Leave request workflow is owned by the microservice (a **MyCompany-owned service**) and exposed to employees through its API. MyCompany upstream applications must use the microservice for time-off workflow—not HCM directly.

The microservice stores the **minimal local HCM copy** defined in **§5.1**—not a full employment replica.

| Data Domain | System Owner | Local Copy | Employee-Facing Interface |
|---|---|---|---|
| Employee profile (name, phone, etc.) | HCM | Not stored | HCM or upstream when needed |
| Email | HCM | Nightly-synced on employee record | Microservice (notifications) |
| Manager | HCM | Nightly-synced on employee record | Microservice |
| Department | HCM | Nightly-synced on employee record | Microservice |
| Employment status | HCM | Nightly-synced on employee record | Microservice |
| Leave types | HCM | Nightly-synced working copy | Microservice |
| Leave policies and accrual rules | HCM | Nightly-synced working copy | Microservice |
| Leave balances | HCM | Nightly-synced working copy | Microservice |
| Balance ledger | HCM | Nightly-synced when included in batch | Microservice |
| HCM employee ID mapping | Microservice | Employee record | Internal |
| Leave request | Time Off Microservice | Workflow state | Time Off Microservice |
| Approval history | Time Off Microservice | Workflow state | Time Off Microservice |
| Pending balance overlay | Time Off Microservice | Derived | Internal |
| Nightly sync metadata | Time Off Microservice | Internal | Internal |
| Audit logs (workflow + HCM calls) | Time Off Microservice | Internal | Internal / HR admin reports |

---

## 9. Technology Stack

- **Language:** Node.js / TypeScript
- **Framework:** Fastify
- **Database:** SQLite for development
- **ORM:** Prisma
- **Authentication:** JWT
- **Jobs/Scheduler:** cron

### Additional Implementation Guidance
- Fastify plugins should be used for:
  - Prisma client registration
  - JWT verification
  - route grouping/versioning
  - request context/correlation IDs
- Prisma schema should be designed to avoid SQLite-only assumptions.
- Cron jobs should be used for:
  - **nightly time-off batch sync** (primary HCM refresh)
  - reminder notifications
  - optional reconciliation checks (local working copy vs HCM batch sample)

---

## 10. Database Requirements

## 10.1 Purpose of Local Database
The local database supports:
- workflow state management (leave requests, approvals)
- minimal HCM employee records (mapping + email, manager, department, employment status)
- nightly-synced local time-off working copy (balances, types, policies)
- pending balance overlay for in-flight requests
- auditability
- reporting
- operational resilience between nightly sync runs

## 10.2 Development Database
- SQLite must be used for local development and lightweight deployment scenarios.

## 10.3 Core Tables
- `employee_hcm_mappings` (minimal employee record: mapping + email, manager, department, employment status)
- `time_off_sync_state`
- `leave_types`
- `leave_policies`
- `leave_policy_rules`
- `leave_balances`
- `leave_balance_ledger` (optional; populated from nightly batch when provided)
- `leave_requests`
- `approvals`
- `holidays`
- `notifications`
- `audit_logs`
- `integration_events`
- `idempotency_keys`

## 10.4 Example Table Structures

### employee_hcm_mappings
- id (internal UUID)
- external_employee_id (HCM employee ID)
- email
- manager_external_employee_id
- manager_id (FK → employee_hcm_mappings.id, resolved nightly)
- department
- employment_status
- sync_correlation_key (optional)
- last_synced_at
- created_at
- updated_at

### leave_requests
- id
- employee_id (FK → employee_hcm_mappings)
- leave_type_id
- start_date
- end_date
- duration_minutes_or_days
- partial_day_type
- status
- reason
- filing dimensions (e.g. location_id)
- hcm_reference_id (returned by HCM realtime API)
- submitted_at
- updated_at
- cancelled_at

### leave_balance_ledger (from nightly batch when provided by HCM)
- id
- employee_id
- leave_type_id
- external_ledger_entry_id
- entry_type
- amount
- effective_date
- reference_type
- reference_id
- last_synced_at

### approvals
- id
- leave_request_id
- approver_employee_id
- approval_level
- decision
- comment
- decided_at

---

## 11. Integration Requirements

### Integration Context and Challenges

This microservice is **owned and operated by MyCompany** and is MyCompany's integration boundary with customer HCM platforms for time-off workflow. It is **not the only system that writes to HCM**. Customer environments may change time-off balances through HCM-native processes and other integrations—for example:
- work anniversary accrual grants
- calendar or fiscal year-start balance refreshes
- HR or payroll adjustments performed directly in HCM
- other third-party systems writing to the same HCM tenant

The microservice must therefore treat HCM as a **multi-writer system of record**. The **nightly batch sync** refreshes the local time-off working copy; **request-time realtime API** calls keep HCM aligned on each leave operation.

HCM exposes **two integration surfaces** used together:

| Mode | When | Purpose |
|---|---|---|
| **Batch API** | **Nightly** (primary) | Pull employment snapshot (email, manager, department, employment status) + time-off corpus with dimensions; update local employee records and time-off working copy |
| **Realtime API** | **Each leave request operation** | Get fresh context and **update HCM time-off information** (file, approve, cancel, reverse) for a specific employee + dimension combination |

Between nightly syncs, validation and display use the **local time-off working copy**. Each submit/approve/reject/cancel also invokes the realtime API so HCM remains the authoritative ledger.

## 11.1 HCM Integration Modes
The service must support:
- HCM **realtime** REST API — invoked on **each leave request operation** to read and **update** time-off values by employee and dimensions
- HCM **batch** REST API — invoked **nightly** to refresh local employee records (email, manager, department, employment status) and the time-off working copy
- optional webhook push (time-off change notifications that may trigger early reconciliation; does not replace nightly sync)
- optional manual batch trigger for operations (`POST /api/v1/sync/time-off`)

The service must **not** maintain a separate full employment sync schedule.

## 11.2 Sync and Request-Time Behavior

**Nightly batch sync (required):**
- run once per night via cron
- pull employment snapshot + time-off corpus from HCM batch endpoint
- upsert employee records (email, manager, department, employment status); resolve manager FKs
- upsert leave types, policies, balances, and ledger rows (when provided)
- overwrite local time-off working copy from batch; preserve pending overlay
- record sync metadata and audit the run

**Request-time realtime API (required on each leave operation):**
- **submit** — validate locally (including employment status + manager from nightly snapshot), then call HCM to file/register time off; store `hcm_reference_id`
- **approve** — call HCM to post confirmed usage
- **reject / cancel** — call HCM to withdraw or reverse time-off entry when applicable
- use HCM response to confirm success and capture errors
- update local workflow state only after successful HCM interaction (or defined compensating flow on failure)
- optionally refresh the affected balance row in the local working copy from the realtime response

**Between nightly runs:**
- validation, approval routing, and balance display use local employee records + time-off working copy + pending overlay
- manager, department, employment status, and email are **not** re-fetched from HCM on each time-off request

## 11.3 Defensive Validation and HCM Error Handling

The microservice must validate leave requests **before** relying on HCM to reject bad data.

**Local defensive checks (required, before each HCM realtime call):**
- resolve employee record and confirm **employment status** is active (from nightly snapshot)
- resolve **manager** for approval routing (from nightly snapshot)
- resolve dimension set to a row in the **local time-off working copy**
- reject unknown dimension combinations locally (`INVALID_TIME_OFF_DIMENSIONS`)
- compute available balance from nightly-synced balance minus local pending overlay
- reject insufficient balance locally (`INSUFFICIENT_BALANCE`) when policy disallows negative balances
- validate dates, overlaps, and eligibility against synced policy data

**HCM realtime validation (required on each operation, supplementary):**
- invoke HCM realtime API to **update** time-off information for the operation
- map HCM errors: `HCM_VALIDATION_ERROR`, `HCM_INSUFFICIENT_BALANCE`, `HCM_UNAVAILABLE`
- **Do not assume HCM always rejects invalid requests**—local checks must pass before the call; treat unexpected HCM success as a reconciliation signal

**Validation points:**
1. **On submit** — local working copy + overlay; then HCM realtime file/register
2. **On approve / reject / cancel** — local state check; then HCM realtime update
3. **Nightly** — batch sync reconciles local working copy with HCM corpus; log external changes

## 11.4 Conflict Rules
- Nightly batch payload **overwrites** local time-off working copy values for mapped employees.
- Externally initiated HCM balance changes appear in the next nightly batch (or realtime response) and overwrite local balance rows.
- Workflow-owned records (leave requests, approvals) are never overwritten by batch sync.
- Local pending balance overlay is microservice-owned and excluded from batch overwrite.
- Employee HCM mapping and employment snapshot fields (**email**, **manager**, **department**, **employment status**) are overwritten nightly from HCM batch; not updated authoritatively via time-off APIs.
- If a realtime response and local working copy disagree after an operation, update the affected local row from the realtime response and log reconciliation metadata.

---

## 12. API Requirements

## 12.1 API Style
- REST over HTTPS
- JSON payloads using **JSON:API v1.1** document structure
- Versioned endpoints, e.g. `/api/v1/...`
- Standard HTTP status codes
- Stateless authentication using JWT
- Pagination, filtering, and sorting where relevant

## 12.2 JSON:API v1.1 Compliance Requirements
Responses must follow JSON:API v1.1 conventions where applicable:
- top-level members may include:
  - `jsonapi`
  - `data`
  - `errors`
  - `meta`
  - `links`
  - `included`
- Resource objects must include:
  - `type`
  - `id`
  - `attributes`
- Relationships should use JSON:API `relationships` objects.
- Errors should follow JSON:API error object structure.
- Collection responses should support pagination links and metadata where applicable.
- Content type should be:
  - `application/vnd.api+json`

### Notes
- Internal implementation may use DTOs, but external API responses must be JSON:API compliant.
- If POST/PATCH request payloads also follow JSON:API resource object conventions, they must be validated accordingly.

---

## 12.3 Example Resource Types
- `employees`
- `leave-requests`
- `leave-types`
- `leave-balances`
- `approvals`
- `policies`
- `audit-logs`

---

## 12.4 Example Endpoints
### Employee Records and Sync
- `GET /api/v1/employees/{id}` (returns local employee record including email, manager, department, employment status + time-off summary from nightly sync)
- `POST /api/v1/sync/time-off` (manual trigger of nightly batch job)
- `GET /api/v1/sync/status`

### Leave Types and Policies (from nightly-synced local working copy)
- `GET /api/v1/leave-types`
- `GET /api/v1/policies`

### Leave Requests
- `POST /api/v1/leave-requests`
- `GET /api/v1/leave-requests/{id}`
- `GET /api/v1/leave-requests`
- `PATCH /api/v1/leave-requests/{id}`
- `POST /api/v1/leave-requests/{id}/cancel`

### Approvals
- `GET /api/v1/approvals/pending`
- `POST /api/v1/leave-requests/{id}/approve`
- `POST /api/v1/leave-requests/{id}/reject`

### Balances (from nightly-synced local working copy, with pending overlay)
- `GET /api/v1/employees/{id}/balances`
- `GET /api/v1/employees/{id}/balance-ledger`

### Reports
- `GET /api/v1/reports/leave-usage`
- `GET /api/v1/reports/team-calendar`
- `GET /api/v1/reports/audit`

---

## 12.5 Example JSON:API Response

### Create Leave Request Response
```json
{
  "jsonapi": {
    "version": "1.1"
  },
  "data": {
    "type": "leave-requests",
    "id": "lr_789",
    "attributes": {
      "status": "pending",
      "startDate": "2026-07-10",
      "endDate": "2026-07-12",
      "partialDay": false,
      "reason": "Family travel",
      "submittedAt": "2026-06-05T10:15:00Z"
    },
    "relationships": {
      "employee": {
        "data": {
          "type": "employees",
          "id": "emp_123"
        }
      },
      "leaveType": {
        "data": {
          "type": "leave-types",
          "id": "vacation"
        }
      }
    }
  }
}
```

### Example Error Response
```json
{
  "jsonapi": {
    "version": "1.1"
  },
  "errors": [
    {
      "status": "422",
      "code": "INSUFFICIENT_BALANCE",
      "title": "Insufficient balance",
      "detail": "Employee does not have enough vacation balance."
    }
  ]
}
```

---

## 13. Authentication and Authorization

### Authentication
- JWT must be used for API authentication.
- Tokens must be validated on protected routes.
- Service-to-service HCM integration may use a separate JWT or machine credential flow.

### Authorization Roles
- employee
- manager
- hr_admin
- system_admin
- integration_client

### Authorization Requirements
- Employees may access only their own records unless explicitly delegated.
- Managers may access records for their reporting chain where authorized.
- HR admins may access synced policy and balance data and manage workflow operations; balance and policy changes are made in HCM.
- Integration clients may access only approved sync/integration endpoints.

---

## 14. Error Handling Requirements
- Errors must follow JSON:API error object structure.
- Validation errors must identify invalid fields where possible.
- Correlation IDs should be included in logs and may be returned in `meta` for debugging.
- HCM integration failures must not expose sensitive internals.

Example:
```json
{
  "jsonapi": {
    "version": "1.1"
  },
  "errors": [
    {
      "status": "503",
      "code": "HCM_UNAVAILABLE",
      "title": "HCM unavailable",
      "detail": "Nightly time-off synchronization could not be completed at this time."
    }
  ],
  "meta": {
    "correlationId": "abc-123"
  }
}
```

---

## 15. Operational Requirements
- Structured application logging
- Correlation/request IDs
- Health endpoints:
  - `/health/live`
  - `/health/ready`
- Metrics should include:
  - request latency
  - error rates
  - nightly time-off sync success/failure counts
  - HCM realtime API call success/failure counts (per operation type)
  - pending approval counts
  - cron job success/failure
- Cron jobs must be observable through logs and metrics.

---

## 16. Internal Service Components
- Fastify route controllers
- authentication plugin
- authorization guards/hooks
- JSON:API serializer/deserializer layer
- Prisma repositories
- leave request service (orchestrates workflow + request-time HCM calls)
- balance service (local working copy read/write)
- approval engine
- policy engine (nightly-synced HCM rules)
- nightly time-off batch sync service
- HCM realtime client (per-request updates)
- defensive validation layer
- HCM adapter/client
- audit service
- notification service
- cron job scheduler

---

## 17. Assumptions
- A supported HCM platform (e.g. Workday, SAP SuccessFactors) exposes API or webhook capability for employment and time-off data.
- HCM performs authoritative accrual, balance accounting, and policy management.
- Employees request time off through this microservice; HCM is not the primary leave-request channel in this architecture.
- The service persists **minimal employee records** (email, manager, department, employment status) and a **nightly-synced time-off working copy**—not a full employment replica.
- HCM exposes **realtime** (per-request get/update) and **batch** (nightly corpus) APIs for time-off data.
- **Nightly batch sync** is the primary mechanism to refresh local employee snapshot fields and time-off data; decisions between runs use that snapshot.
- **Each leave request operation** invokes the HCM realtime API to update HCM time-off information.
- HCM balance changes may originate outside the microservice (anniversary accrual, year-start refresh, other integrations).
- HCM may return validation errors on leave filing, but error coverage is not guaranteed; the microservice must validate defensively.
- JSON:API v1.1 will be used consistently across externally exposed resources.
- SQLite is sufficient for development and low-scale environments.

---

## 18. Risks

See **§5.1** for risks inherent in the minimal local HCM copy decision. Additional project risks:

- SQLite has limited write concurrency.
- Pending balance overlay may diverge from HCM until the next request-time HCM update or nightly sync.
- **External HCM writers** may change balances without the microservice's knowledge until the next nightly batch.
- **Request-time HCM dependency**—submit/approve/cancel require HCM realtime availability even if local snapshot exists.
- **Non-deterministic HCM validation**—HCM may not always reject invalid dimension combinations or insufficient balance; defensive local validation is mandatory.
- Dimensional balance models (e.g. per `locationId`) increase matching complexity between requests, the local working copy, and HCM APIs.
- JSON:API adds implementation complexity compared with simpler ad hoc JSON responses.
- Complex leave policy rules may increase service and schema complexity.

---

## 19. Acceptance Criteria
- APIs return JSON:API v1.1 compliant responses.
- JWT-protected endpoints authorize access correctly.
- Employees can submit and track leave requests through the microservice API.
- Fastify service handles leave request lifecycle and approvals.
- Prisma persists workflow data, employee records (email, manager, department, employment status), and nightly-synced time-off working copy to SQLite in development.
- Architecture decision **§5.1** (minimal local HCM copy) is implemented as specified.
- Email, manager, department, and employment status are available locally from nightly sync without per-request HCM employment API calls.
- Notifications resolve recipient **email** from nightly-synced employee records.
- Nightly batch sync from HCM is idempotent and auditable.
- Each leave request operation invokes the HCM realtime API to update HCM **time-off** information (not employment reads).
- Defensive local validation runs before every HCM realtime call.
- Local workflow decisions use nightly-synced employee and time-off data between sync runs.
- No full local replica of HCM employment master data (name, phone, hire dates, etc.) is maintained.
- HCM (e.g. Workday, SAP) remains the source of truth for employment and time-off master data.
- Nightly cron job successfully executes the batch sync.
- The microservice remains the employee-facing interface for time-off requests and approvals within the MyCompany platform.

