# Technical Requirements Document v2
## Time Off Management Microservice

**Owner:** MyCompany  
**Document status:** Draft  
**Primary audience:** Engineering, product, security, and implementation partners

---

## 1. Executive Summary

The Time Off Management Microservice is a MyCompany-owned backend service that provides the employee-facing workflow for time-off requests, approvals, balance visibility, notifications, audit, and reporting. It is consumed by MyCompany applications and authorized integrations through a REST API.

The service does not replace a customer's Human Capital Management (HCM) platform. HCM systems such as Workday or SAP SuccessFactors remain authoritative for employment data, leave balances, accruals, carryover, leave policies, eligibility rules, and time-off accounting. The microservice is the **only** system of record for the approval workflow; HCM is not used to submit, approve, reject, route, or reconcile manager approval decisions.

The microservice owns the employee-facing workflow experience around HCM master data and balance accounting.

The service keeps a deliberately small local working copy of HCM data:

- A nightly-synced employee snapshot containing only the fields needed for workflow: HCM employee ID mapping, email, manager, department, employment status, and sync metadata.
- A nightly-synced time-off working copy containing the final/current HCM state needed by the service: leave types, policies, balances, and dimensions.
- Locally owned workflow records such as leave requests, approvals, audit logs, notifications, pending balance reservations, and a balance ledger used for workflow, audit, and reporting.

Employees and managers interact with time off through this microservice, not directly through HCM. For Workday v1, submit creates a local pending request and pending balance reservation without writing to HCM; HCM is called at approval time to post the time-off entry and at cancel of an approved entry to correct/delete it in HCM. Submit and approve attempt realtime balance reads from HCM when available, but fall back to the local working copy and ledger when HCM realtime calls cannot be completed. When HCM is unavailable during approval, the request moves to `approved_pending_hcm_update` and the service retries the HCM write hourly for up to 24 hours before auto-rejecting. Employment fields are not re-fetched from HCM on each request.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Provide a dedicated employee-facing API for requesting, approving, cancelling, and tracking time off.
- Preserve HCM as the source of truth for employment and time-off master data.
- Maintain only the minimum local HCM data required for workflow, notifications, validation, and reporting.
- Initialize the local database from an HCM batch corpus, then refresh employee snapshot fields and time-off data through nightly HCM batch syncs.
- Call HCM in realtime to read balances at submit and approve, and to write authoritative HCM state only at approval and approved-entry cancel/correction.
- Expose JSON:API v1.1 compliant REST endpoints.
- Support JWT authentication and role-based authorization.
- Support local development with SQLite while keeping the persistence model portable to a production relational database.
- Keep HCM integration, workflow orchestration, policy validation, and persistence concerns cleanly separated.

### 2.2 Non-Goals

- Payroll processing.
- Benefits administration.
- Full employee lifecycle management.
- Authoritative leave balance, accrual, carryover, or policy management.
- A full local replica of HCM employment data.
- A frontend or UI implementation.
- Replacing HCM as the system of record for employment or time-off accounting.
- Importing, observing, or reconciling HCM approval workflow state during nightly sync or through HCM business-process polling.

---

## 3. System Boundary

| Concern | System of Record | Local Copy | Employee-Facing Interface |
|---|---|---|---|
| Leave request workflow | Time Off Microservice | Workflow state | Time Off Microservice |
| Approval workflow | Time Off Microservice | Workflow state | Time Off Microservice |
| Email | HCM | Nightly employee snapshot | Time Off Microservice notifications |
| Manager, department, employment status | HCM | Nightly employee snapshot | Time Off Microservice |
| Leave types and policies | HCM | Nightly time-off working copy | Time Off Microservice |
| Balances, accrual, carryover | HCM | Current balance snapshot only | Time Off Microservice |
| Local balance ledger | Time Off Microservice | Workflow entries and sync adjustments | Time Off Microservice reports |
| Pending balance reservations | Time Off Microservice | Workflow overlay | Internal |
| Employee profile data such as name or phone | HCM | Not stored | HCM or upstream applications |

The microservice is the workflow boundary. HCM remains the authority for employee master data, balances, leave types, policies, and time-off accounting writes initiated by this service after local approval. Approval routing and decisions happen only in the microservice; nightly HCM sync does not import pending approvals, approver actions, or other HCM workflow state.

---

## 4. Target Architecture

### 4.1 Service Components

The service consists of:

- Fastify REST API layer.
- JSON:API serialization and error handling layer.
- Authentication and authorization layer.
- Domain services for requests, approvals, balances, policies, and notifications.
- Persistence layer using Prisma.
- HCM batch integration client.
- HCM realtime integration client.
- Cron-based background job scheduler for nightly sync and hourly HCM approval retries.
- Audit and integration event logging.

### 4.2 Technology Stack

| Area | Requirement |
|---|---|
| Language | Node.js / TypeScript |
| Web framework | Fastify |
| ORM | Prisma |
| Development database | SQLite |
| Authentication | JWT |
| Background jobs | cron |
| API style | REST over HTTPS with JSON:API v1.1 payloads |

### 4.3 Architectural Principles

- The microservice is the only source of approval workflow state, routing, and decision history.
- HCM provides employee master data, balances, leave types, policies, and accounting persistence for approved usage; it does not participate in manager approval workflow for requests created through this service.
- HCM owns employment records, policy definitions, balances, accruals, and ledger accounting.
- Local HCM data is a working copy, not a competing source of truth.
- The microservice may keep a local balance ledger for workflow, audit, and reporting, but HCM's final balance remains the reconciliation target.
- Request-time HCM calls are scoped to time-off balance reads and to writes that post or reverse approved usage, not general employment reads.
- The system validates defensively before calling HCM because HCM validation responses may be incomplete.
- Workflow reads remain available during temporary HCM outages by using the last successful nightly snapshot.
- Submit and reject may proceed using local working-copy and ledger data when HCM realtime balance reads cannot be completed.
- Approve transitions to `approved_pending_hcm_update` when the HCM write cannot complete; an hourly background job retries the HCM post for up to 24 hours before auto-rejecting.
- Cancel of approved entries requires successful HCM realtime writes; those operations fail safely when HCM is unavailable unless a defined compensating flow applies.
- Route handlers stay thin and delegate business rules to services.
- HCM-specific logic is isolated behind adapters.
- Database design avoids SQLite-only assumptions.

---

## 5. Architecture Decision: Minimal Local HCM Copy

### 5.1 Decision

The service will store a minimal local HCM working copy refreshed nightly, plus workflow records owned by the microservice. It will not maintain a full employment replica.

This decision balances workflow autonomy, notification delivery, defensive validation, operational resilience, integration cost, and data minimization.

### 5.2 Local Data Layers

| Layer | Stored Locally | Refresh Model | Purpose |
|---|---|---|---|
| Employee snapshot | Internal UUID, HCM employee ID, email, manager external ID, resolved manager ID, department, employment status, sync metadata | Nightly HCM batch | Eligibility checks, approval routing, notifications, employee-to-HCM ID mapping |
| Time-off working copy | Leave types, policies, rules, balances, and dimensions representing final/current HCM state | Nightly HCM batch | Balance display, policy checks, defensive validation |
| Local balance ledger | Workflow balance entries, pending reservations, confirmed usage, reversals, and nightly sync adjustments | Realtime workflow + nightly reconciliation | Workflow, audit, reporting, and local balance reconstruction |
| Workflow overlay | Leave requests, approvals, notifications, audit logs | Realtime inside microservice | Employee-facing workflow and local state |
| Request-time HCM state | Workday WIDs and integration outcomes (`timeOffEntryWID`, correction/event metadata) | Per approve/cancel operation | Post approved time-off accounting entries to HCM and correct/delete approved entries |

### 5.3 Employee Snapshot Fields

The employee snapshot stores only these fields:

| Field | Source | Required | Classification | Notes |
|---|---|---:|---|---|
| `id` | Microservice | Yes | Internal | Stable internal UUID |
| `external_employee_id` | HCM | Yes | Internal ID | Natural key for HCM mapping |
| `email` | HCM | Yes | PII/contact | Used only for workflow notifications |
| `manager_external_employee_id` | HCM | No | Internal ID | Raw HCM manager pointer |
| `manager_id` | Derived | No | Internal | Resolved to another local employee |
| `department` | HCM | No | Org attribute | Used for routing and eligibility when policy requires it |
| `employment_status` | HCM | Yes | Org attribute | Examples: active, inactive, terminated, on_leave |
| `sync_correlation_key` | HCM | No | Internal | Optional batch correlation value |
| `last_synced_at` | Microservice | Yes | Internal | Snapshot freshness indicator |

### 5.4 Data Explicitly Not Stored

The service must not store the following employee profile fields unless this architecture decision is revised:

- Name.
- Phone number.
- Hire date.
- Termination date.
- Employment type.
- Full location profile on the employee record.
- Full organization hierarchy.
- Payroll, compensation, national identifier, or special-category data.

Location or other filing dimensions may still be stored on time-off records when required by HCM for balance matching.

### 5.5 PII and Retention Rules

- Email is the only contact PII stored locally.
- Email must not appear in application logs, audit before/after snapshots, error payloads, or metrics labels.
- Email must be encrypted at rest where the datastore supports it.
- Snapshot data is exposed only to authorized users and service clients.
- Departed or off-boarded employees are marked inactive when they disappear from HCM batch data; they are not hard-deleted while referenced by workflow or audit records.
- Unreferenced employee snapshot records may be purged after a configurable grace period.
- On verified erasure requests, email may be redacted in place while preserving non-PII workflow linkage, subject to MyCompany retention policy.

### 5.6 Rationale

- The microservice needs stable employee mapping, manager routing, employment status checks, and notification email without adding a per-request employment API dependency.
- HCM batch data is sufficient for v1 workflow freshness requirements.
- HCM remains a multi-writer system, so a larger local replica would drift and increase reconciliation burden.
- The minimal snapshot reduces local PII and compliance scope.
- Nightly sync gives read resilience when HCM realtime APIs are degraded.
- HCM writes at approval and approved-entry cancel preserve HCM authority for actual time-off accounting changes, while local pending workflow preserves employee-facing responsiveness when HCM reads are degraded.

---

## 6. Functional Requirements

### 6.1 Employee Snapshot Management

The service must maintain one local employee snapshot per mapped HCM employee. The initial service bootstrap creates the local employee baseline from an HCM batch corpus. Recurring nightly syncs continue to upsert employee records from HCM batch data so newly added HCM employees are mapped locally.

Requirements:

- Initialize the local employee snapshot table during service bootstrap by requesting HCM batch data and creating records keyed by `external_employee_id`.
- Upsert employee records during recurring nightly sync using `external_employee_id`.
- Store email, manager, department, employment status, sync correlation key, and `last_synced_at`.
- Resolve `manager_id` after employees in a batch are upserted.
- Treat snapshot fields as read-only locally.
- Exclude inactive, terminated, missing-from-sync, or unresolved employees from new request submission and approver selection where applicable.
- Avoid per-request HCM employment API reads for email, manager, department, or employment status.
- Leave requests must store the internal `employee_id`. HCM employee IDs may be accepted only in privileged HR-admin or integration flows, and must be resolved to an internal employee record before the leave request is persisted.
- New employee records may be created automatically from recurring nightly sync data. Privileged HR-admin or integration flows may also create a mapping from a valid HCM employee ID before creating a request, but normal employee-facing requests must not bypass the local mapping.

### 6.2 Nightly HCM Batch Sync

The service must support an initial bootstrap run that requests HCM batch data to initialize the local database. After bootstrap, the service must run a nightly cron job that upserts employee snapshots and refreshes the time-off working copy.

The nightly sync must:

- Pull an HCM batch payload containing employment snapshot fields and time-off master data only: employee snapshot fields, leave types, policies, policy rules, balances, and dimensions.
- During initial bootstrap, create the local employee baseline from the HCM batch payload.
- During recurring nightly sync, upsert employee records from the HCM batch payload, including newly added HCM employees.
- Resolve manager relationships.
- Upsert leave types, policies, policy rules, balances, and dimensions representing HCM's final/current time-off state.
- Preserve microservice-owned workflow records and local balance ledger entries.
- Compare each HCM final balance to the balance calculated from the local ledger for the same employee, leave type, and dimension set.
- Insert a nightly sync adjustment ledger entry when the calculated local ledger balance differs from HCM's final balance.
- Ensure sync adjustment entries are idempotent, with at most one adjustment per sync run and balance key.
- Record sync metadata, correlation IDs, timing, counts, and success or failure status.
- Be idempotent and safe to retry.
- Log externally originated HCM balance changes when batch values change without a matching local workflow event.

The nightly sync must **not** import, infer, or overwrite local approval workflow state from HCM. It must not read HCM pending approvals, manager decisions, business-process approval status, or time-off request workflow queues for the purpose of driving local request status. Any HCM time-off entries created outside this microservice may affect balances during sync reconciliation, but they do not create or update local leave-request workflow records.

A manual operations endpoint may trigger the same sync process, but it does not replace the nightly schedule.

### 6.3 Leave Types and Policies

Leave types and policies are authored in HCM and consumed locally from the nightly time-off working copy.

Requirements:

- Use synced leave types and policy rules for eligibility checks, balance display, and approval routing when available.
- Do not allow administrators to authoritatively create, edit, or delete HCM-owned leave types or accrual policies through this service.
- Include `lastSyncedAt` metadata where policy freshness matters.
- Support policy dimensions required by HCM, such as location or other filing attributes.

### 6.4 Balance Management

The service must expose balances using the nightly HCM working copy plus a microservice-owned local balance ledger. HCM remains authoritative for final balance values, while the local ledger supports workflow, audit, and reporting.

Requirements:

- Store balances by employee, leave type, and HCM dimensions.
- Store local balance ledger rows for microservice workflow events, reporting, audit, and nightly reconciliation adjustments.
- Do not import authoritative HCM balance ledger rows in v1. The HCM batch corpus provides current/final state, not HCM ledger history.
- Compute current balance from the local ledger for internal reporting and reconciliation.
- Compute available balance as the ledger-derived current balance minus pending reservations, adjusted by policy rules.
- After each nightly sync, the balance calculated from local ledger entries must equal the final/current balance provided by HCM for the same employee, leave type, and dimensions.
- When HCM's final balance differs from the ledger-derived balance, append a local adjustment entry tied to the sync run. This adjustment represents external HCM activity such as accrual, carryover, expiration, HR adjustment, or another integration's write.
- Never authoritatively post accrual, carryover, expiration, or manual balance adjustments to HCM locally; local adjustment entries are reconciliation records only.
- Update affected local balance rows from successful HCM realtime responses at approve or cancel of approved entries when HCM returns fresh balance values.
- Reconcile local balance rows and local ledger totals on nightly sync.
- Expose balance freshness metadata in API responses.

### 6.5 Leave Request Workflow

Employees and authorized delegates submit leave requests through the microservice.

Each request must support:

- Requesting employee.
- Leave type.
- Start date and end date.
- Duration or partial-day details.
- Filing dimensions required by HCM.
- Optional reason or comment.

Workflow requirements:

- Supported states are `draft`, `pending`, `approved_pending_hcm_update`, `approved`, `rejected`, and `cancelled`.
- On submit, validate locally, attempt to read the latest HCM balance for the worker (for example `GET /balances?worker={workerWID}` and optional Workday preflight reads when configured), and when sufficient balance is available create a local `pending` leave request plus a `pending_reservation` ledger entry. Do **not** call `POST /workers/{workerWID}/requestTimeOff` at submit.
- When HCM realtime balance reads cannot be completed at submit, validate against the local time-off working copy and ledger-derived available balance and continue with the same local pending workflow.
- On approve, record the approval decision, retry HCM realtime balance reads for the worker, re-validate available balance, then call `POST /workers/{workerWID}/requestTimeOff` to post the approved time off to HCM. On success, update local workflow state to `approved`, persist Workday entry/event IDs, convert the pending reservation to `confirmed_usage` in the local ledger, and refresh affected balance rows from HCM when returned.
- When the HCM realtime API is unavailable at approval time (for example timeout, transport failure, or HTTP 401/403/5xx mapped to `HCM_UNAVAILABLE`), do not leave the request in `pending`. Transition it to `approved_pending_hcm_update`, persist approval history and retry metadata, and keep the pending reservation in place until HCM confirms the write or the retry window expires.
- Run an hourly cron job that retries HCM approval posts for requests in `approved_pending_hcm_update`. Each retry attempt must refresh balance context when HCM reads are reachable, then call `requestTimeOff`. On success, transition the request to `approved` and finalize ledger usage as in the normal approve path.
- Retry HCM approval posts hourly for up to 24 hours from the first failed approval write. After 24 hours or after all scheduled hourly retries are exhausted without a successful HCM write, automatically transition the request to `rejected`, release the pending reservation with a `reservation_release` ledger entry, record an auto-rejection reason indicating HCM sync failure, and notify affected parties.
- On reject, update local workflow state to `rejected`, record approval history, release the pending reservation with a `reservation_release` ledger entry, and complete the workflow without writing to HCM.
- On cancel of a `pending` request, update local workflow state to `cancelled` and release the pending reservation locally without calling HCM.
- On cancel of an `approved_pending_hcm_update` request, update local workflow state to `cancelled`, stop further HCM retry processing, and release the pending reservation locally without calling HCM because no HCM time-off entry exists yet.
- On cancel of an `approved` request, call `POST /workers/{workerWID}/correctTimeOffEntry` with `delete=true` to remove the approved Workday time-off entry from HCM. On success, update local workflow state to `cancelled` and revert the approval locally by appending a ledger entry that inverts the approved usage (for example `usage_reversal` paired with reservation release semantics as defined by the ledger model).
- Persist audit records for every workflow transition and HCM interaction.
- Use transactions for coupled local state changes.
- Use idempotency keys for write operations that may be retried by clients.

#### 6.5.1 HCM Approval Retry Job

When approval cannot post to HCM because the realtime API is unavailable:

- Transition the leave request to `approved_pending_hcm_update`.
- Persist approval history, `hcm_retry_started_at`, `hcm_retry_deadline_at` (24 hours after the first failed write), and initialize `hcm_retry_count`.
- Keep the existing `pending_reservation` ledger entry in place until HCM confirms the write or the retry window expires.
- Emit an approval-pending-HCM-update notification.

An hourly cron job must:

- Select leave requests in `approved_pending_hcm_update` whose `hcm_retry_deadline_at` has not passed.
- Attempt the same balance refresh and `requestTimeOff` flow used at approval time.
- On success, transition the request to `approved`, persist Workday identifiers, convert the pending reservation to `confirmed_usage`, and emit a request-approved notification.
- On HCM unavailability, increment `hcm_retry_count`, update `last_hcm_retry_at`, and leave the request in `approved_pending_hcm_update` for the next hourly attempt.
- On HCM validation failure during retry, stop automatic retries, transition the request to `rejected`, release the pending reservation, and emit a rejection notification with the mapped error context.
- When `hcm_retry_deadline_at` is reached without a successful HCM write, automatically transition the request to `rejected`, release the pending reservation, record auto-rejection metadata indicating exhausted HCM retries, and emit an HCM approval sync failed notification.

Hourly retries must be idempotent and safe to run concurrently with manual operational triggers.

### 6.6 Defensive Validation

The service must validate locally before each HCM realtime call and before creating local pending workflow state.

Local checks include:

- Employee exists and has active employment status.
- Leave type exists.
- Employee is eligible for the leave type according to synced policy data.
- Required filing dimensions are present and match a local balance or policy row.
- Date range is valid.
- Request does not conflict with overlapping local requests.
- Available balance is sufficient when policy disallows negative balances.
- Approver can be resolved from nightly manager snapshot or synced policy rules.

At submit, attempt HCM realtime balance reads when HCM is reachable. When those reads succeed, use the returned balance for validation. When HCM realtime reads fail or time out, fall back to the local time-off working copy and ledger-derived available balance and continue with local pending workflow if validation passes.

At approve, retry HCM realtime balance reads before posting to HCM. Approval must not proceed to the HCM write when refreshed balance is insufficient unless product policy explicitly allows proceeding on warning.

HCM realtime validation at approve is supplementary to local checks. If HCM accepts an approved request that local data expected to fail, the service must log reconciliation metadata. If HCM rejects an approval write with a validation error, the service maps the error to a stable JSON:API error code and leaves the request in `pending` unless a defined compensating flow applies. If HCM is unavailable, transition to `approved_pending_hcm_update` and defer to the hourly retry job rather than leaving the request in `pending`.

### 6.7 Approval Workflow

The microservice is the only source of approval workflow. Managers and HR users approve or reject requests entirely within this service. HCM holds employee and balance master data and receives accounting writes after local approval, but HCM does not own, route, or complete the approval workflow for requests submitted through this microservice.

The service must support approval routing and decision capture.

Requirements:

- Resolve direct manager approval from nightly-synced manager data.
- Use synced policy rules for multi-step, HR, or auto-approval routing where provided.
- Support single-step approval, multi-step approval, HR approval, and auto-approval.
- Capture approver, approval level, decision, comment, timestamp, and audit metadata.
- Prevent terminated, inactive, or missing-from-sync employees from acting as approvers.
- On approve, refresh HCM balance context with retried realtime reads, post the approved time off to HCM, and finalize local `approved` state and confirmed ledger usage only after the Workday write succeeds. When the HCM write is unavailable, transition to `approved_pending_hcm_update` and enqueue hourly HCM retry processing for up to 24 hours.
- On reject, finalize local `rejected` state, release pending reservations, and do not write to HCM.
- Requests in `approved_pending_hcm_update` are not eligible for manual re-approval; they remain in that state until an hourly retry succeeds or the 24-hour retry window expires and the service auto-rejects them.
- Preserve approval history after a request reaches a terminal state.

### 6.8 Notifications

The service must generate notification events for workflow and operational events.

Notification events include:

- Request submitted.
- Request approved.
- Approval pending HCM update.
- HCM approval sync failed.
- Request rejected.
- Request cancelled.
- Overdue approvals.
- Low balance warnings.
- Sync failures.

Recipient email addresses must come from the nightly-synced employee snapshot. The service must not call HCM at send time solely to resolve notification email addresses.

Notification delivery may be implemented internally or delegated to another service. Downstream notification handlers receive the resolved email and event payload from the microservice.

### 6.9 Reporting

The service must expose reporting data for:

- Leave balances.
- Pending balance overlay.
- Leave usage.
- Pending approvals.
- Team calendar views.
- Audit exports.
- Sync health.
- HCM integration outcomes.

Reports must respect authorization rules and should identify snapshot freshness where values come from nightly HCM data.

### 6.10 Audit Logging

The service must audit:

- Leave request creation and updates.
- Submission, approval, rejection, cancellation, HCM approval retry attempts, auto-rejection after exhausted HCM retries, and terminal state changes.
- HCM realtime calls and responses at a safe metadata level.
- Nightly sync attempts and results.
- Administrative and security-sensitive actions.
- Reconciliation events and externally originated HCM changes.

Audit logs must not include email values, sensitive HCM payloads, credentials, or full before/after snapshots containing PII.

---

## 7. Integration Requirements

### 7.1 HCM Integration Surfaces

The service uses two HCM integration modes. For v1, the concrete HCM adapter target is **Workday Absence Management v5**, defined in `docs/hcm/workday/absenceManagement_v5_20260530_oas2.json`.

| Mode | Frequency | Purpose |
|---|---|---|
| Batch sync | Initial bootstrap and nightly | Import HCM employee snapshot fields and time-off master data: leave types, policies, balances, and dimensions |
| Realtime API | Submit balance read, approve write, cancel/correct, and optional accounting verification reads | Read current balances at submit/approve; post approved time-off accounting entries to Workday; correct/delete approved entries; optionally verify posted entry identifiers |

Workday Absence Management v5 does **not** expose a single batch-corpus endpoint. Nightly sync must aggregate data from paginated collection endpoints such as `GET /workers`, `GET /balances?worker={workerWID}`, and `GET /workers/{workerWID}/eligibleAbsenceTypes`. Nightly sync must not consume HCM endpoints or payloads whose purpose is approval workflow state.

Optional webhooks may trigger early balance or master-data reconciliation, but they do not replace the nightly batch sync and must not drive local approval workflow state.

### 7.2 Workday Absence Management v5 Realtime API

**Service base path:** `https://{tenantHostname}/absenceManagement/v5`

**Worker path parameter:** `{workerWID}` is the Workday worker ID stored locally as `external_employee_id`.

#### 7.2.1 Realtime Endpoint Inventory

| Purpose | Method | Workday endpoint |
|---|---|---|
| Read current balances at submit/approve | `GET` | `/balances?worker={workerWID}&effective={yyyy-mm-dd}` |
| Post approved time off to HCM | `POST` | `/workers/{workerWID}/requestTimeOff` |
| Cancel or correct approved time off | `POST` | `/workers/{workerWID}/correctTimeOffEntry` |
| Read eligible absence types | `GET` | `/workers/{workerWID}/eligibleAbsenceTypes` |
| Validate requested dates | `GET` | `/workers/{workerWID}/validTimeOffDates` |
| Read worker time-off entries | `GET` | `/workers/{workerWID}/timeOffDetails` |
| Read one time-off entry | `GET` | `/workers/{workerWID}/timeOffDetails/{timeOffEntryWID}` |

`timeOffDetails` reads are optional accounting-verification helpers after local approve or cancel-of-approved writes. They must not be used to import, reconcile, or overwrite local approval workflow state during nightly sync or background jobs.

Prompt/value endpoints such as `GET /values/timeOff/status/` may be used to resolve Workday status WIDs during adapter implementation when verifying posted accounting entries. They must not be used as an approval-workflow source of truth.

#### 7.2.2 Prescribed Workday Approval Post Flow

Workday documents time-off submission as a three-step flow. The adapter should follow it at **approval** time unless local defensive validation already covers the same checks. Submit does not call Workday to create a time-off entry.

1. `GET /workers/{workerWID}/eligibleAbsenceTypes` (optional when configured)
2. `GET /workers/{workerWID}/validTimeOffDates?timeOff={absenceTypeWID}&date={yyyy-mm-dd}&date={yyyy-mm-dd}` (optional when configured)
3. `GET /balances?worker={workerWID}&effective={yyyy-mm-dd}` to refresh balance context before the write
4. `POST /workers/{workerWID}/requestTimeOff`

Approval requests use `multipart/form-data` with a required `jsonData` part. The JSON body must include:

- `days[]` time-off entries with at least `date`, `timeOffType.id`, and quantity/time fields such as `dailyQuantity`, `start`, and `end` when required by the absence type.
- `businessProcessParameters.action.id` set to Workday **Submitted** action WID `d9e4223e446c11de98360015c5e6daf6`.

This Workday action value is required by the Absence Management API to post an accounting entry. It does **not** mean approval workflow happens in HCM. Approval has already occurred in the microservice before this call is made.

Optional request fields include `position.id`, `reason.id`, `comment`, and Workday worktags when configured for the absence type.

On success, persist returned Workday identifiers as HCM accounting references, including time-off entry IDs from the response `days[]` collection and any event metadata needed for later correction.

#### 7.2.3 Cancel and Correction Mapping

Workday corrections use `POST /workers/{workerWID}/correctTimeOffEntry` with:

- `days[].correctedEntry.id` pointing to the existing Workday time-off entry WID persisted at approval time.
- `days[].delete=true` to delete an approved time-off entry through the Correct Time Off business process.
- `businessProcessParameters.action.id` also set to Submitted WID `d9e4223e446c11de98360015c5e6daf6`.

v1 adapter requirements:

- Use `correctTimeOffEntry` for canceling approved Workday entries that already exist in HCM.
- Do not call HCM at submit or reject; those remain microservice-only workflow actions.
- Do not use HCM REST approve/deny endpoints, HCM business-process polling, or nightly sync to drive local approval workflow state. Approval UX remains entirely in the microservice; HCM receives accounting writes only after local approval.
- Optional `timeOffDetails` reads may verify that a posted entry exists after approve or that a correction removed an entry after cancel-of-approved. They must not change local approval workflow status.

#### 7.2.4 Workday Entry Status Semantics

Workday time-off entry statuses exposed by `timeOffDetails` include **Approved**, **Submitted**, **Not Submitted**, and **Sent Back**. These values describe HCM accounting-entry state after a write, not microservice approval workflow state.

Workday business-process response fields such as `businessProcessParameters.overallStatus` are integration metadata for posted accounting entries. They must **not** be treated as authoritative approval-workflow outcomes for requests managed by this microservice.

Local approval workflow state is owned exclusively by the microservice. Nightly sync must not map HCM entry statuses or business-process states into local `pending`, `approved`, `rejected`, or `cancelled` workflow transitions.

Optional post-write verification may use HCM entry reads only to confirm accounting persistence:

| Workday observation | Allowed use |
|---|---|
| Matching time-off entry WID present after approve write | Confirm HCM accounting entry was created |
| Entry absent after cancel-of-approved correction | Confirm HCM accounting entry was removed |
| Unexpected validation or transport failure on write | Log integration metadata; local workflow remains governed by microservice rules such as `approved_pending_hcm_update` retry or auto-reject |

Do not use HCM **Sent Back**, **Denied**, or **Terminated** statuses observed outside this service's write flow to approve, reject, or reroute locally managed requests.

#### 7.2.5 Request-Time Adapter Behavior

For each leave operation:

- Run local defensive validation first.
- For submit, attempt `GET /balances?worker={workerWID}` and optional Workday preflight reads when configured. Do not call `requestTimeOff`. Persist local `pending` workflow state and a pending reservation ledger entry when validation passes, using HCM balance data when available and local working-copy/ledger data when HCM reads fail.
- For approve, retry balance reads, optionally run Workday preflight reads, then call `requestTimeOff`. Finalize local `approved` state and confirmed ledger usage only after the Workday write succeeds. When the HCM realtime API is unavailable, transition to `approved_pending_hcm_update`, persist retry metadata, and rely on the hourly retry job for up to 24 hours before auto-rejecting.
- For reject, update local workflow state and release pending reservations without calling HCM.
- For cancel of a pending or `approved_pending_hcm_update` request, update local workflow state and release pending reservations without calling HCM.
- For cancel of an approved HCM entry, call `correctTimeOffEntry` with `delete=true`, then append a local ledger entry that inverts the approved usage.
- Capture Workday WIDs and integration metadata in `hcm_reference_id` and integration-event records when HCM accounting writes occur.
- Support optional header `wd-warning-action: updateonwarning` only when product policy explicitly allows proceeding on Workday warning validations.
- Map Workday validation errors to stable service error codes.
- Refresh affected balance rows from `GET /balances?worker={workerWID}` when Workday returns fresh balance context after approve or cancel of approved entries.

#### 7.2.6 Workday Error Mapping

Map common Workday validation codes to service errors:

| Workday code | Service error |
|---|---|
| `A1011` insufficient balance / not eligible | `HCM_INSUFFICIENT_BALANCE` or `POLICY_VIOLATION` |
| `A1041`, `A1026`, `A1790` worker/position not eligible | `POLICY_VIOLATION` or `EMPLOYEE_INACTIVE` |
| `A1008`, `A1028`, `A1042` overlapping time off | `OVERLAPPING_REQUEST` |
| `A1038`, `A1017`, `A1016`, `A1020` invalid quantity/date payload | `HCM_VALIDATION_ERROR` |
| `A1051` already canceled | `INVALID_WORKFLOW_TRANSITION` |
| HTTP 401/403 from Workday | `HCM_UNAVAILABLE` or auth/integration failure metadata |
| Other Workday critical validation | `HCM_VALIDATION_ERROR` |

Log Workday `error`, `errors[]`, and `code` values in integration events without storing sensitive payloads in audit snapshots.

### 7.3 Nightly Workday Batch Sync Sources

For Workday v1, nightly/bootstrap sync should aggregate **employee and time-off master data only**:

- worker mappings from locally known `external_employee_id` values plus any worker discovery source configured for the tenant;
- leave types from `GET /workers/{workerWID}/eligibleAbsenceTypes`;
- current balances from `GET /balances?worker={workerWID}&effective={syncDate}`;
- absence categories from Workday category WIDs:
  - Time Off: `7bd6531c90c100016d4b06f2b8a07ce`
  - Leave of Absence Type: `17bd6531c90c100016d74f8dfae007d0`
  - Absence Table: `17bd6531c90c100016da3f5b554007d2`

Nightly sync must **not** import HCM approval queues, pending manager actions, business-process approval status, or time-off request workflow history. Those concerns belong to the microservice only.

Employee snapshot fields such as email, manager, and department may require complementary Workday services outside Absence Management v5. Those fields remain part of the TRD employee snapshot, but their Workday source APIs are tenant-specific and may be documented separately.

### 7.4 Multi-Writer HCM Assumption

The service is not the only writer to HCM. Balances may change because of:

- Work anniversary accruals.
- Calendar or fiscal year resets.
- HR adjustments.
- Payroll processes.
- Other third-party integrations.

The nightly sync reconciles the local time-off working copy with HCM's current state. Workflow-owned records are never overwritten by batch data. If external HCM activity changes a final balance without a corresponding local workflow entry, the service records a local sync adjustment entry so the local ledger-derived balance matches HCM.

### 7.5 Conflict Rules

- HCM batch data overwrites the local time-off working copy.
- HCM batch data overwrites employee snapshot fields.
- Workflow records, approvals, notifications, audit logs, and local balance ledger entries are owned by the microservice and are not overwritten by HCM batch data.
- HCM batch data must never create, update, or cancel local leave-request workflow state based on HCM approval activity.
- HCM realtime response data may update affected balance rows immediately after a successful approve or cancel-of-approved operation.
- Nightly sync must reconcile ledger-derived balances to HCM final balances by appending idempotent sync adjustment entries rather than rewriting prior workflow ledger entries.
- Any conflict between local expectations and HCM accounting or balance outcomes must create integration event metadata for operational review. Such conflicts must not silently override local approval workflow decisions.

---

## 8. API Requirements

### 8.1 API Style

- REST over HTTPS.
- Versioned endpoints under `/api/v1`.
- JSON:API v1.1 request and response documents where applicable.
- JWT authentication for protected routes.
- Standard HTTP status codes.
- Pagination, filtering, and sorting for collections.
- Correlation IDs for request tracing.

### 8.2 JSON:API Requirements

Responses must support JSON:API v1.1 conventions:

- Top-level `jsonapi`, `data`, `errors`, `meta`, `links`, and `included` members as applicable.
- Resource objects with `type`, `id`, `attributes`, and `relationships`.
- JSON:API error objects for all errors.
- `application/vnd.api+json` content type.
- Pagination links and metadata for collection responses.

### 8.3 Resource Types

Expected resource types include:

- `employees`
- `leave-requests`
- `leave-types`
- `leave-balances`
- `approvals`
- `policies`
- `audit-logs`
- `sync-runs`

### 8.4 Endpoint Inventory

Employee and sync endpoints:

- `GET /api/v1/employees/{id}`
- `GET /api/v1/sync/status`
- `POST /api/v1/sync/time-off`

Leave type and policy endpoints:

- `GET /api/v1/leave-types`
- `GET /api/v1/policies`

Leave request endpoints:

- `POST /api/v1/leave-requests`
- `GET /api/v1/leave-requests`
- `GET /api/v1/leave-requests/{id}`
- `PATCH /api/v1/leave-requests/{id}`
- `POST /api/v1/leave-requests/{id}/cancel`

Approval endpoints:

- `GET /api/v1/approvals/pending`
- `POST /api/v1/leave-requests/{id}/approve`
- `POST /api/v1/leave-requests/{id}/reject`

Balance endpoints:

- `GET /api/v1/employees/{id}/balances`
- `GET /api/v1/employees/{id}/balance-ledger`

The balance ledger endpoint returns the microservice-owned workflow and reconciliation ledger. It is not a complete authoritative HCM accounting ledger.

Report endpoints:

- `GET /api/v1/reports/leave-usage`
- `GET /api/v1/reports/team-calendar`
- `GET /api/v1/reports/audit`

### 8.5 Example Success Response

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
  },
  "meta": {
    "correlationId": "req_abc123"
  }
}
```

### 8.6 Example Error Response

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
      "detail": "Employee does not have enough vacation balance for this request."
    }
  ],
  "meta": {
    "correlationId": "req_abc123"
  }
}
```

### 8.7 Error Codes

The service should expose stable error codes, including:

- `AUTHENTICATION_REQUIRED`
- `FORBIDDEN`
- `EMPLOYEE_NOT_FOUND`
- `EMPLOYEE_INACTIVE`
- `LEAVE_TYPE_NOT_FOUND`
- `INVALID_DATE_RANGE`
- `OVERLAPPING_REQUEST`
- `INVALID_TIME_OFF_DIMENSIONS`
- `INSUFFICIENT_BALANCE`
- `POLICY_VIOLATION`
- `APPROVER_NOT_FOUND`
- `INVALID_WORKFLOW_TRANSITION`
- `HCM_VALIDATION_ERROR`
- `HCM_INSUFFICIENT_BALANCE`
- `HCM_UNAVAILABLE`
- `SYNC_IN_PROGRESS`

---

## 9. Authentication and Authorization

### 9.1 Authentication

- Protected API routes require JWT authentication.
- Tokens must be verified before route handlers execute.
- Service-to-service HCM credentials must be managed separately from user JWTs.
- Integration credentials must not be logged.

### 9.2 Roles

Supported roles:

- `employee`
- `manager`
- `hr_admin`
- `system_admin`
- `integration_client`

### 9.3 Authorization Rules

- Employees may access only their own requests, balances, and visible workflow records unless delegated access exists.
- Managers may access requests and balances for authorized reporting-chain employees.
- HR admins may access workflow, reports, audit exports, and synced policy or balance data.
- HR admins may not authoritatively modify HCM-owned balances, accruals, or policy rules through this service.
- System admins may operate sync and maintenance endpoints.
- Integration clients may access only explicitly approved integration endpoints.

---

## 10. Data Model Requirements

### 10.1 Database Purpose

The local database supports:

- Employee HCM mapping and minimal snapshot fields.
- Nightly time-off working copy.
- Leave request workflow state.
- Approval records.
- Pending balance overlay.
- Local balance ledger for workflow, audit, reporting, and nightly reconciliation adjustments.
- Notifications.
- Audit logs.
- Integration events.
- Sync state and operational metadata.

### 10.2 Core Tables

Expected core tables:

- `employee_hcm_mappings`
- `time_off_sync_state`
- `leave_types`
- `leave_policies`
- `leave_policy_rules`
- `leave_balances`
- `leave_balance_ledger`
- `leave_requests`
- `approvals`
- `holidays`
- `notifications`
- `audit_logs`
- `integration_events`
- `idempotency_keys`

### 10.3 Representative Table Fields

`employee_hcm_mappings`:

- `id`
- `external_employee_id`
- `email`
- `manager_external_employee_id`
- `manager_id`
- `department`
- `employment_status`
- `sync_correlation_key`
- `last_synced_at`
- `created_at`
- `updated_at`

`leave_requests`:

- `id`
- `employee_id`
- `leave_type_id`
- `start_date`
- `end_date`
- `duration_minutes_or_days`
- `partial_day_type`
- `status`
- `reason`
- `filing_dimensions`
- `hcm_reference_id` (Workday time-off entry WID or primary Workday event reference)
- `hcm_retry_started_at`
- `hcm_retry_deadline_at`
- `hcm_retry_count`
- `last_hcm_retry_at`
- `submitted_at`
- `updated_at`
- `cancelled_at`

`leave_balance_ledger`:

- `id`
- `employee_id`
- `leave_type_id`
- `filing_dimensions`
- `entry_type`
- `amount`
- `source`
- `leave_request_id`
- `approval_id`
- `hcm_reference_id`
- `sync_run_id`
- `idempotency_key`
- `effective_at`
- `created_at`

Expected `entry_type` values include `opening_balance`, `pending_reservation`, `confirmed_usage`, `reservation_release`, `usage_reversal`, and `sync_adjustment`.

Expected `source` values include `workflow`, `hcm_realtime_response`, and `hcm_nightly_reconciliation`.

`approvals`:

- `id`
- `leave_request_id`
- `approver_employee_id`
- `approval_level`
- `decision`
- `comment`
- `decided_at`

### 10.4 Persistence Requirements

- Prisma schema design must remain portable beyond SQLite.
- Domain writes that change workflow state must be transactional.
- Unique constraints must protect HCM external IDs, HCM reference IDs, and idempotency keys where applicable.
- Data access should be organized behind repository or service boundaries.
- JSON columns or serialized fields must be used carefully to avoid blocking future PostgreSQL migration.

---

## 11. Non-Functional Requirements

### 11.1 Performance

- Common read endpoints should respond within 500 ms under normal load.
- Common write endpoints should respond within 1 second, excluding HCM latency where separately measured.
- Common reporting endpoints should respond within 2 to 5 seconds.
- Nightly sync may run asynchronously and must not block normal reads.

### 11.2 Availability and Resilience

- Target service availability is 99.9%.
- Workflow reads and balance views should remain available using the last successful snapshot during HCM outages.
- Submit and reject may proceed using local working-copy and ledger data when HCM realtime balance reads are unavailable.
- Approve may transition to `approved_pending_hcm_update` when the HCM write is unavailable; hourly retries continue for up to 24 hours before auto-reject.
- Cancel of approved entries requires successful HCM realtime writes and must fail safely when HCM is unavailable unless a defined compensating flow applies.
- Sync jobs must be retryable and idempotent.
- Repeated sync failures must surface through logs, metrics, and sync status endpoints.

### 11.3 Reliability

- Coupled workflow and integration state changes must have clear transaction or compensation behavior.
- Cron jobs must record execution outcome, duration, and failure details.
- HCM realtime calls must use timeouts, retries where safe, and idempotency controls.
- Write endpoints must tolerate client retries through idempotency keys.

### 11.4 Security

- All protected endpoints require JWT authentication.
- Authorization is role-based.
- TLS is required in transit.
- HCM credentials must be stored securely and rotated according to MyCompany policy.
- Email must be protected as contact PII.
- Logs, metrics, errors, and audit records must not leak sensitive HCM payloads or credentials.

### 11.5 Maintainability

- Fastify plugins should handle Prisma registration, JWT verification, route grouping, and request context.
- Route handlers should be thin.
- HCM adapters should hide vendor-specific payloads from domain services.
- JSON:API serialization should be centralized.
- Policy and validation logic should be testable outside route handlers.

### 11.6 Observability

The service must emit structured logs and metrics for:

- Request latency.
- Error rates.
- HCM realtime call success and failure counts by operation.
- Nightly sync success and failure counts.
- Sync duration, imported row counts, and staleness.
- HCM approval retry success and failure counts.
- Count of requests in `approved_pending_hcm_update`.
- Notification event creation and delivery failures.
- Reconciliation events.

Health endpoints:

- `/health/live`
- `/health/ready`

---

## 12. Operational Requirements

- Run nightly HCM sync through cron with configurable schedule.
- Run hourly HCM approval retry processing through cron for requests in `approved_pending_hcm_update`, retrying for up to 24 hours from the first failed approval write before auto-rejecting.
- Provide operational visibility through sync status endpoints.
- Support manual sync trigger for authorized operators.
- Use correlation IDs across API, jobs, HCM calls, logs, and audit metadata.
- Alert on failed syncs, stale sync age, elevated HCM errors, exhausted HCM approval retries, and notification delivery failures.
- Keep workflow state available even when HCM sync is stale, while exposing staleness clearly in metadata.
- Document runbooks for HCM outage, failed nightly sync, repeated HCM validation errors, exhausted HCM approval retries, and data reconciliation.

---

## 13. Assumptions

- Workday Absence Management v5 is the v1 HCM adapter reference (`docs/hcm/workday/absenceManagement_v5_20260530_oas2.json`).
- Workday exposes realtime write APIs through `requestTimeOff` (at approval) and `correctTimeOffEntry` (at cancel of approved entries), plus read APIs for balances, eligible absence types, valid dates, and time-off details.
- Submit creates local pending workflow state only; `requestTimeOff` is called at approval time, not at submit.
- When HCM is unavailable during approval, requests enter `approved_pending_hcm_update` and are retried hourly for up to 24 hours before auto-rejection.
- Workday Absence Management v5 does not expose REST approve/deny endpoints for this integration model; the microservice is the only approval-workflow system of record and posts approved time-off accounting entries to HCM on approve.
- Nightly sync imports employee and time-off master data only; it does not import HCM approval workflow state.
- Nightly sync for Workday aggregates paginated GET responses rather than consuming a single HCM batch-corpus payload.
- HCM performs authoritative accrual, balance accounting, carryover, expiration, and policy management.
- Employees request time off through the microservice in the MyCompany platform.
- HCM may receive changes from systems other than this microservice.
- The service can perform an initial bootstrap from HCM batch data to create the local employee baseline and time-off working copy.
- After bootstrap, recurring nightly sync continues to upsert employee records from HCM batch data.
- Nightly freshness is acceptable for v1 employee snapshot and time-off working copy.
- JSON:API v1.1 will be used consistently for externally exposed resources.
- SQLite is sufficient for development and low-scale local environments.

---

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Stale manager data | Request may route to an outdated approver until next sync | Nightly sync, audit approval actions, expose `lastSyncedAt`, consider intraday sync if SLA requires it |
| Stale employment status | Inactive employee may pass local checks before next sync | Local active check, HCM rejection mapping, optional high-risk realtime spot checks |
| Stale balances | External HCM writers may change balances between syncs | Pending overlay, balance read at submit/approve with local fallback, approval-time HCM write, nightly reconciliation adjustment entries |
| Ledger drift | Local workflow ledger total may differ from HCM final balance after external HCM activity | Compare ledger-derived balance to HCM final balance each sync; append idempotent sync adjustment entries |
| New employee sync delay | Employee added to HCM after bootstrap cannot request leave until the next successful nightly sync or privileged mapping flow | Clear `EMPLOYEE_NOT_FOUND` errors before sync; upsert new employees during nightly sync; allow privileged mapping when operationally needed |
| Stale email | Notification may use outdated email until next sync | Nightly refresh, validation on ingest, notification failure monitoring |
| HCM realtime outage | Workday approval post or approved-entry correction cannot complete at first attempt; submit/reject may continue locally | Transition approved requests to `approved_pending_hcm_update`, retry hourly for 24 hours, auto-reject and release reservations when retries are exhausted, alert operators |
| Workday approval gap | Absence Management v5 has no REST approve/deny endpoint used by this service | Keep all approval workflow in the microservice; post accounting entries with `requestTimeOff` only after local approval; do not reconcile local workflow from HCM business-process status |
| HCM validation gaps | HCM may accept or reject unexpected payloads | Defensive local validation, stable error mapping, reconciliation logs |
| Dimensional balance complexity | Wrong dimension matching can cause validation errors | Normalize filing dimensions, validate against local working copy, test HCM adapter mappings |
| SQLite write concurrency | Development database may not reflect production concurrency | Keep schema portable and plan production relational database migration |
| JSON:API complexity | Serialization and error handling are more involved | Centralize serializers, response schemas, and error builders |
| PII handling | Email is stored locally | Encrypt where supported, redact logs and audits, support erasure workflows |

---

## 15. Acceptance Criteria

The implementation is acceptable when:

- APIs use JSON:API v1.1 response structures.
- Protected endpoints require JWT authentication.
- Role-based authorization prevents unauthorized employee, manager, HR, admin, and integration access.
- Employees can submit, view, and cancel leave requests through the microservice API.
- Managers and HR users can approve or reject requests according to policy and authorization, and those decisions are sourced only from the microservice.
- Nightly sync imports employee snapshot fields and time-off master data only; it does not import or reconcile HCM approval workflow state into local leave requests.
- Submit creates local `pending` workflow state and a pending reservation ledger entry without calling Workday `requestTimeOff`.
- When HCM realtime balance reads fail at submit, the service validates against local working-copy and ledger data and still creates pending workflow state when validation passes.
- Workday approval uses `POST /workers/{workerWID}/requestTimeOff` with Submitted business-process action WID `d9e4223e446c11de98360015c5e6daf6`, preceded by retried balance reads.
- When the HCM realtime API is unavailable at approval, the request transitions to `approved_pending_hcm_update`, hourly retries run for up to 24 hours, and exhausted retries auto-reject the request and release pending reservations.
- Reject updates local workflow to `rejected`, releases pending reservations, and does not write to HCM.
- Workday cancel of approved entries uses `POST /workers/{workerWID}/correctTimeOffEntry` with `delete=true`, followed by a local ledger entry that inverts the approved usage.
- Local defensive validation runs before submit, before HCM realtime writes, and uses local fallback data when HCM reads are unavailable at submit.
- Initial bootstrap creates the local database baseline from HCM batch data.
- Recurring nightly batch sync upserts employee snapshot fields and imports time-off working copy data.
- Employee snapshot fields include HCM ID mapping, email, manager, department, employment status, and sync metadata.
- The service does not store a full local employment replica.
- Notifications resolve recipient email from the local nightly-synced snapshot.
- Balances are exposed from the local working copy and local ledger with pending overlay and freshness metadata.
- Workflow state, approvals, audit logs, notifications, pending reservations, and local balance ledger entries are owned locally.
- Nightly sync creates idempotent local adjustment entries when needed so ledger-derived balances match HCM final balances.
- HCM remains authoritative for balances, accruals, carryover, policies, and employment data.
- Prisma persists workflow, snapshot, sync, ledger, and audit data to SQLite in development.
- Nightly sync is idempotent, auditable, observable, and manually triggerable by authorized operators.
- HCM outages do not block reads of existing workflow state or last-synced balances, and do not block local submit or reject when local validation passes. Approve may defer HCM writes into `approved_pending_hcm_update` with hourly retries for up to 24 hours; cancel-of-approved HCM writes still fail safely when HCM is unavailable unless a defined compensating flow applies.
- Audit logs capture workflow and integration events without leaking email, credentials, or sensitive HCM payloads.
