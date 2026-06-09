# Technical Requirements Document
## Time Off Management Microservice

**Owner:** MyCompany  
**Document status:** Final  
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

HCM integration is mediated by a vendor-neutral adapter contract (§7.1). v1 ships Workday as the production adapter; Phase 3 completes provider selection and factory indirection so additional HCM platforms can be supported without changing domain workflow logic.

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
- Support multiple HCM platforms through a vendor-neutral adapter contract; v1 ships Workday only, with provider selection and factory indirection completed in Phase 3 (see `docs/spec.md` §13).

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

- NestJS REST API layer.
- JSON:API serialization and error handling layer.
- Authentication and authorization layer.
- Domain services for requests, approvals, balances, policies, and notifications.
- Persistence layer using Prisma.
- HCM integration layer: vendor-neutral batch and realtime client contract (`HcmClient`) with pluggable per-provider adapters; v1 production adapter is Workday Absence Management v5.
- HCM provider factory (`HCM_PROVIDER`) resolving the active adapter at runtime (Phase 3).
- Cron-based background job scheduler for nightly sync and hourly HCM approval retries.
- Audit and integration event logging.

### 4.2 Technology Stack

| Area | Requirement |
|---|---|
| Language | Node.js / TypeScript |
| Web framework | NestJS |
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
- HCM-specific logic is isolated behind per-provider adapters that implement a shared vendor-neutral contract; domain services, routes, and jobs depend on the contract only—not on Workday or other vendor modules directly (Phase 3 enforces factory indirection; see §7.1).
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

**Holiday data (v1):** Public holidays are managed as seed data (`prisma/seed.ts`) and are **not** synchronized from HCM in v1. Duration calculations exclude holidays whose location matches the employee's filing `locationId` dimension (or global holidays). A future phase may introduce an admin endpoint or HCM sync for holiday management; see OQ-9 in `docs/spec.md`.

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

The diagram below shows how the microservice, local persistence, and HCM interact across the primary request lifecycle. Approval routing and decisions happen only in the microservice; HCM receives accounting writes after local approval (or on cancel of an approved entry). Nightly batch sync (employee snapshot and time-off working copy) runs separately and does not drive approval workflow state.

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client App
    participant TOS as Time Off Service
    participant DB as Local DB / Ledger
    participant HCM as HCM (Workday)
    participant Job as HCM Retry Job (hourly)

    rect rgb(240, 248, 255)
        Note over Client,HCM: Submit — local pending workflow only (no HCM write)
        Client->>TOS: POST /api/v1/leave-requests
        TOS->>DB: Defensive validation (snapshot, policy, dimensions, overlap)
        opt HCM balance read reachable
            TOS->>HCM: GET /balances?worker={workerWID}
            HCM-->>TOS: Current balances
        end
        alt HCM read unavailable
            TOS->>DB: Validate against nightly working copy + ledger
        end
        TOS->>DB: status=pending, PENDING_RESERVATION ledger entry
        TOS->>DB: Audit + REQUEST_SUBMITTED notification
        TOS-->>Client: 201 pending
    end

    rect rgb(255, 250, 240)
        Note over Client,HCM: Approve — local decision first, then HCM accounting write
        Client->>TOS: POST /api/v1/leave-requests/{id}/approve
        TOS->>DB: Record approval decision + audit
        TOS->>HCM: GET /balances?worker={workerWID} (retry)
        opt Workday preflight enabled
            TOS->>HCM: GET eligibleAbsenceTypes, validTimeOffDates
        end
        alt HCM write succeeds
            TOS->>HCM: POST /workers/{workerWID}/requestTimeOff
            HCM-->>TOS: timeOffEntryWID + refreshed balances
            TOS->>DB: status=approved, CONFIRMED_USAGE, hcm_reference_id
            TOS-->>Client: 200 approved
        else HCM unavailable (timeout, 5xx, auth)
            TOS->>DB: status=approved_pending_hcm_update, retry metadata
            Note over DB: PENDING_RESERVATION retained
            TOS->>DB: APPROVAL_PENDING_HCM_UPDATE notification
            TOS-->>Client: 200 approved_pending_hcm_update
            loop Hourly, up to 24h from first failed write
                Job->>TOS: Retry approval post
                TOS->>HCM: GET /balances + POST requestTimeOff
                alt Retry succeeds
                    TOS->>DB: status=approved, CONFIRMED_USAGE
                else Deadline reached or validation failure
                    TOS->>DB: status=rejected, RESERVATION_RELEASE
                    TOS->>DB: HCM_APPROVAL_SYNC_FAILED notification
                end
            end
        else HCM validation error at approve
            Note over TOS: Request remains pending; map to JSON:API error
            TOS-->>Client: 422 HCM_VALIDATION_ERROR / POLICY_VIOLATION
        end
    end

    rect rgb(245, 255, 245)
        Note over Client,HCM: Reject — microservice only (no HCM call)
        Client->>TOS: POST /api/v1/leave-requests/{id}/reject
        TOS->>DB: status=rejected, RESERVATION_RELEASE
        TOS->>DB: Audit + REQUEST_REJECTED notification
        TOS-->>Client: 200 rejected
    end

    rect rgb(255, 245, 245)
        Note over Client,HCM: Cancel
        Client->>TOS: POST /api/v1/leave-requests/{id}/cancel
        alt pending or approved_pending_hcm_update
            TOS->>DB: status=cancelled, RESERVATION_RELEASE
            Note over TOS,HCM: No HCM entry exists yet — no HCM call
            TOS-->>Client: 200 cancelled
        else approved (HCM entry posted)
            TOS->>HCM: POST correctTimeOffEntry (delete=true)
            HCM-->>TOS: Correction accepted
            TOS->>DB: status=cancelled, USAGE_REVERSAL ledger entry
            TOS-->>Client: 200 cancelled
        end
    end
```

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

### 7.1 HCM Adapter Abstraction (Multi-Provider)

The microservice must integrate with customer HCM platforms (Workday, SAP SuccessFactors, and others) without embedding vendor-specific logic in domain services. All HCM I/O is mediated by a **vendor-neutral adapter contract**; each supported platform implements that contract in an isolated adapter module.

**Requirements:**

| Concern | Requirement |
|---|---|
| **Contract** | Domain services, routes, and background jobs depend on `HcmClient` and shared neutral types (employee snapshots, balance rows, accounting write payloads). Vendor HTTP clients, payload shapes, and auth live only inside adapter modules. |
| **Provider selection** | The active adapter is resolved at startup from `HCM_PROVIDER` (default `workday` for v1). Invalid values fail fast. Implementation detail: `createHcmClient()` in `hcm.factory.ts` (`docs/spec.md` §10.1). |
| **Capabilities** | Each adapter exposes capability metadata (e.g. batch sync strategy, preflight validation, webhook ingest, accounting writes) so domain code can use optional HCM features without scattering provider checks through services. |
| **Error mapping** | Vendor error codes map to stable service errors (`HCM_VALIDATION_ERROR`, `HCM_INSUFFICIENT_BALANCE`, `HCM_UNAVAILABLE`, …) inside the adapter—not in domain services. |
| **Workflow invariance** | Adapter choice does not change local approval workflow ownership. Submit/reject remain local-only; HCM receives accounting writes after local approval and on cancel of approved entries only. Nightly sync never imports HCM approval workflow state regardless of provider. |
| **Extension** | Adding a new HCM platform requires a new adapter + factory registration and provider-specific configuration—not changes to leave-request, approval, or balance domain logic. |

**Phasing:**

| Phase | Scope |
|---|---|
| Phase 1–2 | Workday is the sole production adapter (`HCM_PROVIDER=workday`). Domain code may call Workday through `HcmClient`; routes/jobs may still import the Workday adapter directly until Phase 3 refactor. |
| Phase 3 | Provider factory, capability model, and `StubAdapter` for automated tests and future provider scaffolding. All routes and jobs import `createHcmClient` from the factory only. SAP SuccessFactors and other targets are out of Phase 3 implementation scope but must be addable without domain changes. |

**Reference implementation:** Workday Absence Management v5 (`docs/hcm/workday/absenceManagement_v5_20260530_oas2.json`). Detailed contract, capabilities interface, and adapter layout: `docs/spec.md` §10.1–§10.2.

### 7.2 HCM Integration Surfaces

The service uses two HCM integration modes. For v1, the concrete HCM adapter target is **Workday Absence Management v5**, defined in `docs/hcm/workday/absenceManagement_v5_20260530_oas2.json`.

| Mode | Frequency | Purpose |
|---|---|---|
| Batch sync | Initial bootstrap and nightly | Import HCM employee snapshot fields and time-off master data: leave types, policies, balances, and dimensions |
| Realtime API | Submit balance read, approve write, cancel/correct, and optional accounting verification reads | Read current balances at submit/approve; post approved time-off accounting entries to Workday; correct/delete approved entries; optionally verify posted entry identifiers |

Workday Absence Management v5 does **not** expose a single batch-corpus endpoint. Nightly sync must aggregate data from paginated collection endpoints such as `GET /workers`, `GET /balances?worker={workerWID}`, and `GET /workers/{workerWID}/eligibleAbsenceTypes`. Nightly sync must not consume HCM endpoints or payloads whose purpose is approval workflow state.

Optional webhooks may trigger early balance or master-data reconciliation, but they do not replace the nightly batch sync and must not drive local approval workflow state.

### 7.3 Workday Absence Management v5 Realtime API

**Service base path:** `https://{tenantHostname}/absenceManagement/v5`

**Worker path parameter:** `{workerWID}` is the Workday worker ID stored locally as `external_employee_id`.

#### 7.3.1 Realtime Endpoint Inventory

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

#### 7.3.2 Prescribed Workday Approval Post Flow

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

#### 7.3.3 Cancel and Correction Mapping

Workday corrections use `POST /workers/{workerWID}/correctTimeOffEntry` with:

- `days[].correctedEntry.id` pointing to the existing Workday time-off entry WID persisted at approval time.
- `days[].delete=true` to delete an approved time-off entry through the Correct Time Off business process.
- `businessProcessParameters.action.id` also set to Submitted WID `d9e4223e446c11de98360015c5e6daf6`.

v1 adapter requirements:

- Use `correctTimeOffEntry` for canceling approved Workday entries that already exist in HCM.
- Do not call HCM at submit or reject; those remain microservice-only workflow actions.
- Do not use HCM REST approve/deny endpoints, HCM business-process polling, or nightly sync to drive local approval workflow state. Approval UX remains entirely in the microservice; HCM receives accounting writes only after local approval.
- Optional `timeOffDetails` reads may verify that a posted entry exists after approve or that a correction removed an entry after cancel-of-approved. They must not change local approval workflow status.

#### 7.3.4 Workday Entry Status Semantics

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

#### 7.3.5 Request-Time Adapter Behavior

For each leave operation:

- Run local defensive validation first.
- For submit, attempt `GET /balances?worker={workerWID}` and optional Workday preflight reads when configured. Do not call `requestTimeOff`. Persist local `pending` workflow state and a pending reservation ledger entry when validation passes, using HCM balance data when available and local working-copy/ledger data when HCM reads fail.
- For approve, retry balance reads, optionally run Workday preflight reads when the adapter reports `supportsPreflightValidation` and tenant config enables it, then call `requestTimeOff`. Finalize local `approved` state and confirmed ledger usage only after the Workday write succeeds. When the HCM realtime API is unavailable, transition to `approved_pending_hcm_update`, persist retry metadata, and rely on the hourly retry job for up to 24 hours before auto-rejecting.
- For reject, update local workflow state and release pending reservations without calling HCM.
- For cancel of a pending or `approved_pending_hcm_update` request, update local workflow state and release pending reservations without calling HCM.
- For cancel of an approved HCM entry, call `correctTimeOffEntry` with `delete=true`, then append a local ledger entry that inverts the approved usage.
- Capture Workday WIDs and integration metadata in `hcm_reference_id` and integration-event records when HCM accounting writes occur.
- Support optional header `wd-warning-action: updateonwarning` only when product policy explicitly allows proceeding on Workday warning validations.
- Map Workday validation errors to stable service error codes.
- Refresh affected balance rows from `GET /balances?worker={workerWID}` when Workday returns fresh balance context after approve or cancel of approved entries.

#### 7.3.6 Workday Error Mapping

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

### 7.4 Nightly Workday Batch Sync Sources

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

### 7.5 Multi-Writer HCM Assumption

The service is not the only writer to HCM. Balances may change because of:

- Work anniversary accruals.
- Calendar or fiscal year resets.
- HR adjustments.
- Payroll processes.
- Other third-party integrations.

The nightly sync reconciles the local time-off working copy with HCM's current state. Workflow-owned records are never overwritten by batch data. If external HCM activity changes a final balance without a corresponding local workflow entry, the service records a local sync adjustment entry so the local ledger-derived balance matches HCM.

### 7.6 Conflict Rules

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
- `GET /api/v1/sync-runs` *(Phase 2)*
- `GET /api/v1/sync-runs/{id}` *(Phase 2)*

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

- NestJS modules should handle Prisma registration, JWT verification, controller grouping, and request context.
- Route handlers should be thin.
- HCM adapters should hide vendor-specific payloads from domain services; routes and jobs must obtain adapters through the provider factory, not vendor modules (Phase 3).
- JSON:API serialization should be centralized.
- Policy and validation logic should be testable outside route handlers.

### 11.6 Observability

The service must emit structured logs and metrics for:

- Request latency.
- Error rates.
- HCM realtime call success and failure counts by provider and operation.
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
- HCM integration follows the multi-provider adapter abstraction in §7.1; Phase 3 completes factory indirection and capability metadata. Additional HCM platforms (e.g. SAP SuccessFactors) are supported by adding adapters, not by changing domain workflow logic.
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
| Dimensional balance complexity | Wrong dimension matching can cause validation errors | Normalize filing dimensions, validate against local working copy, test HCM adapter mappings per provider |
| Multi-provider adapter drift | New HCM adapter may diverge from contract or omit capability flags | Factory + capability tests (IT-3.8–IT-3.9); stub adapter exercises full workflow path in CI |
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
- For `HCM_PROVIDER=workday` (v1): after local approval, the adapter posts the accounting entry via `POST /workers/{workerWID}/requestTimeOff` with `businessProcessParameters.action.id` set to the Workday **Submitted** business-process action WID `d9e4223e446c11de98360015c5e6daf6`. Workday Absence Management requires this value to submit the Request Time Off business process event (see `docs/hcm/workday/absenceManagement_v5_20260530_oas2.json`); it is **not** sent at microservice submit. Retried balance reads precede the write.
- When the HCM realtime API is unavailable at approval, the request transitions to `approved_pending_hcm_update`, hourly retries run for up to 24 hours, and exhausted retries auto-reject the request and release pending reservations.
- Reject updates local workflow to `rejected`, releases pending reservations, and does not write to HCM.
- For `HCM_PROVIDER=workday` (v1): cancel of approved entries uses `POST /workers/{workerWID}/correctTimeOffEntry` with `delete=true`, the same required **Submitted** action WID `d9e4223e446c11de98360015c5e6daf6` in `businessProcessParameters.action.id`, followed by a local ledger entry that inverts the approved usage.
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
- Domain services depend on the vendor-neutral HCM adapter contract only; Phase 3 verifies that routes and jobs resolve adapters through `HCM_PROVIDER` factory indirection with no direct vendor imports (see §7.1, `docs/spec.md` IT-3.8–IT-3.9).

---

## 16. Testing Requirements

This section defines the required testing scenarios for the Time Off Management Microservice. It serves three audiences:

- **Engineering** — ensure automated tests cover every acceptance criterion and critical workflow path before release.
- **QA** — optional manual and exploratory testing when validating a build, staging deployment, or HCM integration change (not required for release; see §16.8).
- **Operations** — verify sync, retry, and outage behavior in integrated environments when performing operational validation.

Detailed endpoint-level test matrices (IT-1.x through IT-3.x), file locations, and implementation-phase scope live in `docs/spec.md` §13–§14. The scenarios below are derived from TRD functional requirements (§6–§12) and acceptance criteria (§15). Automated coverage is the release gate; manual checklists in §16.5–§16.7 are supplementary guidance for exploratory testing.

### 16.1 Test Layers

| Layer | Purpose | When to run |
|---|---|---|
| **Unit** | Policy engine, ledger math, serializers, error mapping, validation helpers | Every commit / CI |
| **Integration** | End-to-end API flows with mocked or local HCM; background jobs with mocked clock | Every commit / CI |
| **Contract** | JSON:API shape, OpenAPI alignment, stable error codes | CI and before API releases |
| **Manual / exploratory** (optional) | Real JWT roles, HCM sandbox or mock toggles, multi-step UX paths, timing-dependent retry jobs | Staging or pre-release when QA chooses; not a release gate |

Automated suites live under `tests/unit/` and `tests/integration/`. Run `npm test` for the full CI matrix.

### 16.2 Scenario Traceability Matrix

Each scenario maps to TRD acceptance criteria (§15), an automated test identifier where implemented, and optional manual QA ideas for staging or exploratory testing.

| ID | Scenario | AC | Automated | Optional manual QA |
|---|---|---|---|---|
| TS-01 | All public endpoints return JSON:API v1.1 documents (`jsonapi`, `data`/`errors`, `meta`, pagination where applicable) | §15 bullet 1 | IT-1.18; unit serializers | Spot-check 3–5 endpoints via API client |
| TS-02 | Protected routes reject unauthenticated requests with 401 and JSON:API `errors` | §15 bullet 2 | IT-1.6, IT-1.18 | Attempt each major resource without JWT |
| TS-03 | Role-based authorization: employee, manager, HR, system admin, integration client | §15 bullet 3 | IT-1.3–1.5, IT-1.8–1.17, IT-2.3–2.5 | Matrix walkthrough per role (§16.6) |
| TS-04 | Employee submits leave request → `pending` + pending reservation; no HCM write at submit | §15 bullets 4, 7 | IT-1.8 | Submit in staging; confirm no Workday entry until approve |
| TS-05 | Submit with HCM balance read failure falls back to local working copy + ledger | §15 bullets 6, 18 | IT-1.8 (HCM down) | Disable/mock HCM reads; submit should still succeed when local balance sufficient |
| TS-06 | Defensive validation: insufficient balance, overlap, invalid dimensions, inactive employee | §15 bullet 11 | IT-1.8; unit policy-engine | Submit invalid combinations; confirm stable error codes |
| TS-07 | Draft request lifecycle: create draft, patch, then submit | §15 bullet 4 | IT-1.8, IT-1.11 | Save draft, edit dates/reason, submit |
| TS-08 | Manager approves → HCM `requestTimeOff` → `approved` + confirmed ledger usage | §15 bullets 4, 8 | IT-1.14 | Approve in staging; verify Workday entry WID persisted |
| TS-09 | Approve with HCM unavailable → `approved_pending_hcm_update`; hourly retry succeeds → `approved` | §15 bullets 9, 18 | IT-1.14, IT-1.18, §14.2 retry | Simulate HCM 503 at approve; wait/trigger retry job; confirm promotion |
| TS-10 | Exhausted HCM approval retries (24 h) → auto-`rejected` + reservation release + failure notification | §15 bullet 9 | IT-2.9, §14.2 exhaustion | Advance clock or wait in test env; confirm auto-reject and notification |
| TS-11 | Manager rejects → local `rejected` only; reservation released; no HCM call | §15 bullet 10 | IT-1.15 | Reject pending request; confirm no Workday write |
| TS-12 | Cancel `pending` → `cancelled` + reservation release; no HCM call | §15 bullet 4 | IT-1.12 | Cancel before approval |
| TS-13 | Cancel `approved_pending_hcm_update` → `cancelled` locally; retries stop; no HCM call | §15 bullet 18 | §14.2 (planned) | Approve into deferred state, then cancel before HCM post succeeds |
| TS-14 | Cancel `approved` → HCM `correctTimeOffEntry` (delete) + usage reversal ledger | §15 bullet 11 | IT-2.8 | Cancel after approval; verify Workday correction and ledger reversal |
| TS-15 | Cancel `approved` when HCM unavailable → fails safely (no partial local cancel) | §15 bullet 18 | Manual / failure injection | Block HCM; attempt cancel; confirm safe failure |
| TS-16 | Nightly/bootstrap sync imports employee snapshot + time-off master data only | §15 bullets 12–13 | IT-1.4, IT-1.5; unit sync.service | Run sync; inspect DB for snapshot fields; confirm no approval state import |
| TS-17 | Sync does not mutate existing leave requests, approvals, or ledger history | §15 bullet 4 | §14.2 sync isolation | Submit request, re-run sync, confirm workflow unchanged |
| TS-18 | Sync idempotent and manually triggerable by authorized operators | §15 bullet 22 | IT-1.4 | Retry sync; confirm no duplicate rows; 403 for employee |
| TS-19 | Ledger reconciliation: sync adjustment when HCM final balance ≠ ledger-derived balance | §15 bullet 21 | unit ledger.service | After external HCM balance change simulation, run sync; inspect adjustment entries |
| TS-20 | Balance read model: current, ledger, pending, available, `lastSyncedAt`, unit | §15 bullet 20 | IT-1.16 | Compare balances before/after submit and approve |
| TS-21 | Balance ledger paginated workflow entries (reservations, usage, releases) | §15 bullet 20 | IT-1.17 | Trace one request through ledger entries |
| TS-22 | Employee snapshot minimal: no name, phone, or hire date in API | §15 bullets 13–14 | IT-1.3 | Inspect employee resource attributes |
| TS-23 | Notifications use nightly-synced snapshot email only; not in audit payloads | §15 bullets 15, 23 | IT-2.10; unit notification, audit | Inspect notification records vs audit after workflow action |
| TS-24 | Idempotency keys on write endpoints prevent duplicate side effects | §11.3 | IT-2.6, IT-2.7 | Replay same `Idempotency-Key`; confirm 409 on body mismatch |
| TS-25 | Reports: leave usage, team calendar, audit export with auth and no email in audit rows | §6.9 | IT-2.3–2.5 | HR/manager report queries with date filters |
| TS-26 | Sync runs history and detail for operators | §12 | IT-2.1, IT-2.2 | List sync runs; open run detail with correlation ID |
| TS-27 | Health: liveness without auth; readiness reflects DB (and optional sync staleness) | §11.6 | IT-1.1, IT-1.2 | Hit `/health/live` and `/health/ready` |
| TS-28 | HCM outage: reads and last-synced balances remain available | §15 bullet 23 | Partial (mock) | Stop HCM; GET balances and leave-requests still 200 |
| TS-29 | `EMPLOYEE_NOT_FOUND` when worker not yet synced | §14 risks | §14.2 cross-cutting | Submit before employee appears in snapshot |
| TS-30 | Multi-step / HR / auto-approval routing from synced policy | §6.7 | IT-3.6 (Phase 3) | Policy with 2-step chain; verify level gating |
| TS-31 | Workday preflight reads at approve when adapter supports preflight and config enables it | §6.5, §7.1 | IT-3.7 (Phase 3) | Enable `WORKDAY_PREFLIGHT_ENABLED`; approve and inspect HCM call log |
| TS-32 | HCM webhook triggers master-data refresh only (no approval mutation) | §7.2 | IT-3.1–3.2 (Phase 3) | Send webhook; confirm balances refresh, requests unchanged |
| TS-33 | Metrics and staleness visibility in operational responses | §11.6 | IT-3.2–3.4 (Phase 3) | Inspect `/metrics` and sync-status staleness fields |
| TS-34 | HCM provider factory: `workday` and `stub` adapters; no direct vendor imports from routes/jobs | §7.1 | IT-3.8 (Phase 3) | Run integration suite with `HCM_PROVIDER=stub`; confirm full workflow path |
| TS-35 | Adapter capability branching (preflight, webhook) without provider checks in domain services | §7.1 | IT-3.9 (Phase 3) | Disable preflight capability; confirm approve skips optional HCM reads |

**Coverage legend:** *Automated* references map to `docs/spec.md` IT- IDs and `tests/` suites and are the release gate. *Optional manual QA* suggestions help exploratory testing but are not required to ship. Scenarios marked *Phase 3* or *planned* remain gated on automated tests landing or explicit product waiver.

### 16.3 End-to-End Workflow Scenarios

These multi-step flows span several endpoints and must pass in CI. They can also be used as optional manual walkthrough scripts in staging (§16.5).

#### WF-1 — Happy path: submit → approve → view balances

1. Authenticate as **employee**; `GET /employees/{id}/balances` — note `availableBalance`.
2. `POST /leave-requests` with `submit: true` — expect `201`, status `pending`, ledger `PENDING_RESERVATION`.
3. Authenticate as **manager**; `GET /approvals/pending` — request appears.
4. `POST /leave-requests/{id}/approve` — expect `approved`, HCM reference ID, ledger `CONFIRMED_USAGE`.
5. As employee, `GET /balances` — `pendingBalance` decreased, usage reflected.
6. **Verify:** no Workday call occurred at step 2; Workday `requestTimeOff` at step 4.

#### WF-2 — Submit with HCM read degradation

1. Configure HCM mock or sandbox to fail balance reads (503/timeout).
2. Submit request with sufficient **local** balance.
3. **Expect:** `pending` created; validation used local working copy.
4. Restore HCM; approve normally.

#### WF-3 — Approve deferred to HCM retry

1. Submit and assign to manager.
2. Configure HCM to fail on `requestTimeOff` at first approve attempt.
3. Approve — **expect** `approved_pending_hcm_update`, notification `APPROVAL_PENDING_HCM_UPDATE`.
4. Trigger or wait for hourly retry job with HCM restored.
5. **Expect** transition to `approved` with HCM reference.

#### WF-4 — Exhausted HCM retries

1. Enter `approved_pending_hcm_update` (as WF-3).
2. Keep HCM unavailable until retry deadline (24 h from first failure).
3. **Expect** auto-`rejected`, `RESERVATION_RELEASE`, notification `HCM_APPROVAL_SYNC_FAILED`.

#### WF-5 — Reject path

1. Submit request.
2. Manager **reject** with optional comment.
3. **Expect** `rejected`, reservation released, no HCM calls, `REQUEST_REJECTED` notification.

#### WF-6 — Cancel variants

| Starting status | Action | Expected outcome | HCM call |
|---|---|---|---|
| `draft` | cancel or delete via patch flow | removed or cancelled locally | None |
| `pending` | `POST .../cancel` | `cancelled`, reservation release | None |
| `approved_pending_hcm_update` | `POST .../cancel` | `cancelled`, retries stopped, reservation release | None |
| `approved` | `POST .../cancel` | `cancelled`, usage reversal | `correctTimeOffEntry` delete |

#### WF-7 — Sync and isolation

1. Bootstrap or `POST /sync/time-off` as **system_admin**.
2. Confirm leave types, policies, balances, employee snapshot populated.
3. Create leave request; re-run sync.
4. **Expect** request status and approval history unchanged (TS-17).

#### WF-8 — Idempotent client retries

1. `POST /leave-requests` with `Idempotency-Key: k1` — note response.
2. Repeat identical request with same key — **expect** same `201` body, single ledger entry.
3. Same key, different body — **expect** `409 IDEMPOTENCY_CONFLICT`.
4. Repeat for approve and sync mutations (IT-2.7).

### 16.4 Unit Test Requirements

The following domain logic must remain testable outside HTTP route handlers (see `tests/unit/`):

- Policy rule resolution and eligibility against nightly working copy.
- Approval chain construction from manager snapshot and policy rules.
- Leave duration, partial-day, holiday exclusion, and overlap detection.
- Balance read model: ledger sum + pending reservations + HCM snapshot overlay.
- Ledger append idempotency and sync-adjustment reconciliation.
- HCM provider factory resolution and adapter capability branching (Phase 3).
- Workday (and future adapter) error code → stable JSON:API error code mapping.
- JSON:API document and pagination builders.
- Audit snapshot redaction (no email).
- Notification payload construction from snapshot email.

### 16.5 Manual QA Checklists by Persona (Optional)

These checklists support exploratory testing and are **not** required for release (§16.8). Use them when QA or operations want to validate a deployment beyond CI. Prerequisites: valid JWTs per role, HCM sandbox or `HCM_PROVIDER=stub` (in-memory adapter), seeded or synced employees with manager hierarchy, at least one leave type with dimensional balance.

#### Employee

- [ ] View own employee record — no name/phone/hire date exposed (TS-22).
- [ ] View leave types and own balances with freshness metadata (TS-20).
- [ ] Create draft; patch dates/reason; submit (TS-07).
- [ ] Submit fails with clear errors: insufficient balance, overlapping dates, bad dimensions (TS-06).
- [ ] List and filter own requests by status (TS-03).
- [ ] Cancel pending request; balance reservation released (TS-12).
- [ ] Cannot view or act on another employee's requests (TS-03).

#### Manager

- [ ] View direct report employee record and balances (TS-03).
- [ ] Pending approvals list shows only assigned requests (TS-03).
- [ ] Approve request — employee sees approved; balances updated (WF-1).
- [ ] Reject request — employee sees rejected; no HCM entry (TS-11).
- [ ] Cannot approve/reject requests not assigned to self (TS-03).
- [ ] Team calendar and leave usage reports for reporting chain (TS-25).

#### HR Admin

- [ ] View policies and org-wide leave usage / audit reports (TS-25).
- [ ] Audit export contains workflow events **without** email fields (TS-23).
- [ ] Cannot trigger sync unless also system admin (TS-03).
- [ ] Submit or manage requests on behalf of employees when policy allows (TS-03).

#### System Admin / Integration Client

- [ ] Trigger manual sync; inspect sync status and sync-runs history (TS-16, TS-26).
- [ ] Sync is safe to run twice without duplicate master data (TS-18).
- [ ] Integration client can sync; employee role receives 403 (TS-03).

#### HCM Integration & Resilience

- [ ] Submit succeeds when HCM balance read fails but local balance sufficient (TS-05, WF-2).
- [ ] Approve enters deferred state when HCM write fails; retry promotes to approved (TS-09, WF-3).
- [ ] Auto-reject after retry exhaustion (TS-10, WF-4).
- [ ] Cancel approved posts HCM correction (TS-14, WF-6).
- [ ] Cancel approved blocked or fails safely when HCM down (TS-15).
- [ ] Reads (balances, requests) work during HCM outage using last snapshot (TS-28).

#### Security & Compliance

- [ ] All protected routes return 401 without JWT (TS-02).
- [ ] Audit logs and report exports exclude email and HCM credentials (TS-23).
- [ ] Error responses use stable `code` values from §8.7 (TS-01, TS-06).

### 16.6 Authorization Spot-Check Matrix (Optional)

When running manual exploratory tests, QA may confirm at least one **allow** and one **deny** case per role for each resource group:

| Resource | Employee (self) | Employee (other) | Manager (report) | Manager (non-report) | HR Admin | System Admin |
|---|---|---|---|---|---|---|
| `GET /employees/{id}` | 200 | 403 | 200 | 403 | 200 | 200 |
| `GET /leave-requests` | own only | 403/empty | team | 403/empty | broader | broader |
| `POST /leave-requests` | 201 self | 403 | 403 unless delegated | 403 | per policy | per policy |
| `POST .../approve` | 403 | 403 | 200 if assigned | 403 | per policy | 403 |
| `GET /policies` | 403 | 403 | 403 | 403 | 200 | 200 |
| `POST /sync/time-off` | 403 | 403 | 403 | 403 | 403 | 200 |
| `GET /reports/audit` | 403 | 403 | 403 | 403 | 200 | 200 |

Automated coverage: IT-1.3–1.5, IT-1.8–1.17, IT-2.3–2.5, IT-1.18.

### 16.7 Exploratory Testing Ideas (Optional)

Beyond checklist execution, QA may probe:

- **Concurrency:** two managers attempting approve/reject on the same pending request.
- **Stale manager:** employee synced with outdated manager ID; approval routing and notifications.
- **Stale balance:** submit against local balance, external HCM writer reduces balance before approve.
- **Partial days and holidays:** half-day AM/PM, requests spanning weekends and holidays.
- **Dimensional filing:** wrong or missing dimension keys vs HCM balance rows.
- **Pagination boundaries:** empty collections, last page, invalid page params.
- **Clock skew:** requests starting in the past or far future; timezone boundaries on dates.
- **Large payloads:** long reason text, maximum date ranges.
- **Correlation IDs:** present in responses and traceable in logs for a failed approve.
- **Phase 3 (when enabled):** multi-step approval order, auto-approve rules, webhook duplicate delivery, preflight validation failures, HCM provider factory and stub adapter runs.

### 16.8 Release Gate

A release candidate is test-complete when:

1. All **Phase 1 and Phase 2** automated scenarios (TS-01 through TS-29, excluding Phase 3-only rows) pass in CI.
2. Every §15 acceptance criterion has at least one passing **automated** verification (unit, integration, or contract tests).
3. Known gaps (Phase 3 scenarios TS-30 through TS-35) are explicitly waived or scheduled with product sign-off.

Manual QA checklists (§16.5–§16.7) and staging walkthroughs are recommended for major HCM or auth changes but are **not** release blockers. Implementation partners should update the *Automated* column in §16.2 when new tests land.

---

## 17. Document History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-06-08 | Added §16 Testing Requirements: scenario traceability matrix, workflow scenarios, manual QA checklists, authorization matrix, and release gate |
| 1.1 | 2026-06-08 | Clarified manual QA checklists are optional guidance; release gate is automated tests only |
| 1.2 | 2026-06-08 | §7.1 HCM adapter abstraction (multi-provider); renumbered §7.2–§7.6; Phase 3 test scenarios TS-34–TS-35; aligned with `docs/spec.md` v1.9 |
| 1.3 | 2026-06-08 | Critical/medium fixes: `sync-runs` endpoints added to §8.4; Workday-specific AC bullets in §15 qualified with `HCM_PROVIDER=workday` prefix; `HCM_MOCK_MODE` replaced with `HCM_PROVIDER=stub` in §16.5; spec cross-ref updated to §10.1–§10.2; holiday management note added to §6.3; aligned with `docs/spec.md` v2.0 |
