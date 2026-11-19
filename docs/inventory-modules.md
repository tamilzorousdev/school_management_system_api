# Inventory & Asset Management – Modules, Purpose and Flow

This document describes every part of the school Inventory system: what each module is for, who uses it, and how the work flows from one step to the next. It covers the **admin web** (used by the store keeper, the office and the approvers) and the small **staff self-service** part (`/me/assets`). There are no Parent or Driver app screens for inventory.

For the exact request and response fields, see the **Inventory and assets** section of `docs/api-guide.md` and the Swagger docs (`/api/docs/admin`, tag `Admin · Inventory`).

---

## 1. Overview

| Who | Where | What they do |
|---|---|---|
| Store keeper | Admin web → Settings → Inventory | Runs the day-to-day work: registers assets, allocates and takes them back, raises transfers and disposals, logs repairs, receives and issues stock, runs audits |
| School admin | Admin web → Inventory | Everything the store keeper does, plus approvals and settings |
| Principal | Admin web → Inventory | Views everything and approves transfers, disposals and requisitions |
| Administrative officer (AO) | Admin web → Inventory | Views everything and approves |
| Staff member | Staff app / API `GET /me/assets` | Sees the assets they hold and confirms they received them |

### Key terms

| Term | Meaning |
|---|---|
| **Asset** | One physical item the school keeps and tracks individually: a laptop, projector, desk, microscope. Each asset has its own **asset tag** (e.g. `TZMS-AST-000041`) printed as a barcode label and stuck on the item. |
| **Stock item** | A consumable counted by quantity, not one by one: A4 paper, chalk, cleaning liquid, lab beakers. |
| **Category** | Groups assets or stock items (e.g. *IT Equipment → Laptops*). Asset categories carry the **depreciation rate** or **useful life** and an optional **maintenance interval**. |
| **Location** | Where an asset physically sits: a classroom, lab, office, staff room, store, library, hall or ground. |
| **Department** | A school department (Science, Office, Sports…) that can hold assets and ask for stock. |
| **Store** | A storeroom that holds stock (e.g. *Central Store*, *Science Lab Store*), with a store keeper. |
| **Allocation** | An asset given to a staff member, a department or a location, with an optional expected return date. |
| **Transfer** | Moving one or more assets from wherever they are now to a new holder, usually after approval. |
| **Disposal** | Removing an asset from the register: sold, scrapped, donated, lost or written off. |
| **Requisition** | A request for stock from a store, e.g. "40 boxes of chalk for the primary block". |
| **Book value** | What an asset is worth today after depreciation (never below its residual value). |
| **Audit** | A physical check: scanning asset tags in a room (asset verification) or counting stock in a store (stock count). |

### Roles and permissions (admin web)

| Permission | Allows | Given to |
|---|---|---|
| `inventory.view` | See all inventory screens and reports | Store keeper, Principal, AO, School admin |
| `inventory.manage` | Register and edit assets, allocate, take back, transfers, disposals, maintenance, masters, settings | Store keeper, School admin |
| `inventory.stock` | Stock items, goods received, issues, adjustments, issuing requisitions | Store keeper, School admin |
| `inventory.approve` | Approve or reject transfers, disposals and requisitions | Principal, AO, School admin |
| `inventory.audit` | Start, scan and close audits | Store keeper, School admin |

The **Store Keeper** role is new. Demo sign-in: `9000000012`, OTP `123456`. A store keeper who has no dashboard permission lands straight on the Inventory page.

---

## 2. The main flow at a glance

**Assets**

```
Set up masters ─► Register asset (tag + label) ─► In store
                                                    │
                     ┌──────────────────────────────┼──────────────────────────┐
                     ▼                              ▼                          ▼
              Allocate to staff /            Transfer request ──► Approve   Repair ticket
              department / location               (or direct when          (in maintenance)
                     │                             approvals are off)          │
          Staff confirms receipt                        │                   Resolve ──► back to
                     │                                  ▼                   previous state
              Take back (to store or            Moved to new holder
              straight to repair)
                     │
        Audit (scan) ─► missing? mark lost ─► found again, or Disposal request ─► Approve ─► Disposed
```

**Stock**

```
Goods received (GRN) ─► Stock in store (average cost) ─► Requisition ─► Approve ─► Issue (full or part)
                                    │                                        
                                    ├─► Direct issue to department / staff / class
                                    ├─► Adjustment (damaged, expired, count correction)
                                    └─► Stock count audit ─► post differences as adjustments
```

Every change to an asset is written to its **history**, and every stock change is a line in the **ledger**, so both can be traced back at any time.

---

## 3. Admin web modules

The Inventory page (sidebar → Settings → **Inventory**, shortcut `g 9`) has these tabs. Tabs a user is not allowed to use are hidden.

### 3.1 Dashboard

**Purpose:** one screen showing what needs attention today.

- **Find an asset:** scan a tag label or type a tag or serial number to open that asset directly.
- **Cards:** total assets and cost, book value after depreciation, allocated / in store / in repair, warranty or AMC ending soon, overdue returns and receipts not yet acknowledged, stock value, low stock, open repairs, maintenance due, and items waiting for approval (transfers, requisitions, disposals).
- **Lists with quick actions:** low stock (→ *Receive*), maintenance due (→ *Start*), warranty ending soon, overdue returns, requisitions, transfers and disposals waiting.

### 3.2 Assets

**Purpose:** the asset register – every asset, where it is and who has it.

- **Insight cards** (click to filter): all assets, in store, allocated, under maintenance, warranty ending, overdue returns, not acknowledged, lost.
- **Filters:** search (tag, name, serial, make, model), status (several at once), category, location, department, custodian, vendor, condition, warranty state, funding.
- **Register asset:** name, category, make, model, quantity (bulk register identical items, one serial number per line), vendor, invoice number and copy, purchase date, cost, residual value, funding source, warranty and AMC dates, AMC vendor, condition, store, location, photo, notes, and *Schedule preventive maintenance* (uses the category's interval). After saving, the new tags are shown with **Print labels**.
- **Import:** download the Excel template, fill one row per item (quantity and serial numbers allowed), **Validate** to see row-by-row errors, then **Import**. New category, location and vendor names are created automatically. **Print labels** prints exactly the imported assets.
- **Print labels:** Code 128 barcode labels for chosen assets, or by location, category or date added.
- **Export CSV:** the asset register with the current search and filters.
- **Row actions:** open, allocate, take back, transfer, open a repair ticket, mark lost, dispose, print label.

**Asset statuses:** `in_store` → `allocated` → (`in_maintenance`) → back; `lost`; `disposed` (final).

### 3.3 Allocations

**Purpose:** who holds what, since when, and when it is due back.

- **Allocate:** choose assets in store (search or scan), then *Give to* a **staff member**, a **department** or a **location**; allocated-on date, optional expected return date, remarks. The staff member gets a push notification.
- **Mark received:** records the staff member's signature on their behalf (when they cannot use the app).
- **Take back:** choose allocated assets, condition now, back to which store, remarks, and optionally **Send to maintenance** (opens a repair ticket at once).
- **Filters:** status (active / returned), attention (overdue, not acknowledged), assignee type, staff, department, location.

### 3.4 Transfers

**Purpose:** move assets to a new holder with an approval trail.

- **New transfer:** choose assets (in store or allocated), *Move to* staff / department / location, reason. Each transfer gets a number like `TZMS-TRF-2026-0001`.
- **When approvals are on** (Settings): the request waits as *Waiting for approval*; approvers get a notification and **Approve** (the move happens at once) or **Reject** (with a note). The requester can **Cancel** while it waits.
- **When approvals are off:** the transfer completes immediately.
- An asset with an open transfer cannot be allocated, marked lost or sent for disposal until the transfer is approved, rejected or cancelled.

### 3.5 Maintenance

**Purpose:** repairs and preventive servicing.

- **Tickets:** *Open ticket* with asset, kind (breakdown, preventive, inspection), problem, details, priority, assigned to, vendor, under warranty. Number like `TZMS-MNT-2026-0004`. While a ticket is open the asset is **in maintenance**; only one open ticket per asset.
  - Move to **in progress**, then **Resolve** (what was done, cost, parts replaced, condition now) or **Cancel** (with a note). The asset goes back to *allocated* or *in store*, whichever it was. The person who reported it is notified.
- **Preventive schedules:** title, interval in days, next due date, vendor, active/paused. **Start** opens the preventive ticket; resolving it moves the next due date forward by the interval.

### 3.6 Stock

**Purpose:** consumables held in stores.

- **Items:** name, code, category, unit (pcs, box, ream, litre…), reorder level. List shows quantity, value and average rate per store; **low** when at or below the reorder level.
- **Receive stock (goods received):** store, vendor, invoice number and date, received on, and lines (item, quantity, rate). Number like `TZMS-GRN-2026-0003`. The average cost is recalculated.
- **Issue:** from a store to a department, a staff member or a class, with a purpose and lines. Issues go out at the average cost.
- **Adjust:** damaged, expired, count correction, returned or other, with a note.
- **Views:** *Items*, *Goods received* (sortable by date, number, vendor, total) and *Ledger* (every movement with balance after).
- You can never issue more than the store holds (`NOT_ENOUGH_STOCK`).

### 3.7 Requisitions

**Purpose:** departments and staff ask for stock; the store issues it after approval.

- **New requisition:** from store, department / staff / class, purpose, needed by, lines. Number like `TZMS-REQ-2026-0007`.
- **Flow:** `pending` → **Approve** (quantities can be reduced line by line) or **Reject** (note) → **Issue** (all, or part now and the rest later: `partly_issued` → `issued`). The requester can **Cancel** before it is issued. Approvers and requesters are notified at each step.
- With requisition approvals off, requests are approved as soon as they are raised.

### 3.8 Audits

**Purpose:** physical verification.

- **Asset verification:** choose what to check (a location, a category or a department) and scan tags. Each scan shows a finding:
  - **found** – where it should be;
  - **misplaced** – it belongs somewhere else;
  - **not available** – the records say lost, disposed or in repair;
  - **unknown** – the tag is not on the register.
  
  Closing shows expected / found / missing and can **mark missing assets lost**.
- **Stock count:** choose a store; the sheet shows the system quantity for each item; enter the counted quantity. Closing can **post differences as adjustments**.
- Only one asset verification can be open at a time.

### 3.9 Disposals

**Purpose:** take assets off the register properly.

- **New disposal:** asset, method (sold, scrapped, donated, lost, written off), reason, value realised. The **book value** on the day is recorded. Number like `TZMS-DSP-2026-0002`.
- An allocated asset must be taken back first.
- With approvals on, an approver **Approves** (the asset becomes *disposed* and leaves the active register) or **Rejects**.

### 3.10 Reports

| Report | Shows |
|---|---|
| **Asset summary** | Count, cost and book value grouped by category, location, department, custodian or status |
| **Depreciation** | Per category: cost, opening value, depreciation for the period, closing value |
| **Maintenance cost** | Repair spend by asset, category and vendor |
| **Consumption** | Stock issued by item and department over a period |
| **Stock valuation** | Quantity and value per item and store as on a date |

Exports: the **asset register** (CSV, with the Assets tab filters) and the **stock ledger** (CSV).

### 3.11 Masters

**Purpose:** the lists everything else uses.

| Master | Notes |
|---|---|
| **Categories** | Asset or stock; parent category; depreciation rate or useful life; maintenance interval |
| **Locations** | Kind, building, floor, class using the room. **Sync rooms** creates locations from the timetable rooms |
| **Departments** | Code and head of department. **Sync** creates departments from staff department names. Each department shows its assets |
| **Vendors** | Contact person, phone, email, GSTIN, address, what they supply |
| **Stores** | Code, location and store keeper |

Anything in use cannot be deleted (`*_IN_USE`); mark it inactive instead. Duplicate codes are refused (`*_EXISTS`).

### 3.12 Settings

| Setting | Default | Effect |
|---|---|---|
| Approve transfers | On | Transfers wait for an approver |
| Approve requisitions | On | Requisitions wait for an approver |
| Approve disposals | On | Disposals wait for an approver |
| Depreciation method | Straight line | Or written-down value |
| Warranty alert | 30 days | How early warranty/AMC endings are flagged |
| Maintenance alert | 7 days | How early preventive maintenance is flagged |

### 3.13 Asset page and stock item page

- **Asset page** (`/inventory/assets/:id`): details, purchase, warranty and AMC, photo, current holder, and tabs **Maintenance**, **Allocations** and **History** (every event: registered, edited, allocated, acknowledged, returned, transferred, repairs, condition changes, audited, lost, found, disposal). Actions: label, allocate, and *More* (edit, transfer, repair, lost/found, dispose, delete if registered by mistake).
- **Stock item page** (`/inventory/stock/:id`): balance and value per store, the item's ledger, edit, and delete when it has no movements.

### 3.14 Assets tab on staff profiles

Staff → a staff member → **Assets** (needs `inventory.view`): what they hold now and what they returned. A staff member who still holds assets **cannot be marked resigned or deleted** (`ASSETS_PENDING`) until everything is taken back or transferred.

---

## 4. Staff self-service (`/me/assets`)

Any signed-in staff member (teacher, office staff, driver…) can use:

| Call | Purpose |
|---|---|
| `GET /me/assets` | The assets I hold now, with tag, name, allocated-on and expected return date |
| `POST /me/assets/{allocationId}/acknowledge` | Confirm I received it (the store keeper sees "acknowledged") |

The push notification for a new allocation opens this list. (A Flutter screen for this is not built yet; the API is ready.)

---

## 5. Alerts and notifications

A daily job runs at **08:15** (school time zone). Admins can run it now with **Run alerts** (`POST /admin/inventory/alerts/run`).

| Template | Sent to | When |
|---|---|---|
| `INVENTORY_ASSET_ASSIGNED` | The staff member | An asset is allocated or transferred to them |
| `INVENTORY_RETURN_DUE` | The staff member | Expected return date passed (day 1, then weekly) |
| `INVENTORY_APPROVAL_NEEDED` | Principal, AO, School admin | A transfer, disposal or requisition is waiting |
| `INVENTORY_REQUEST_UPDATE` | The requester | Their request was approved, rejected or issued |
| `INVENTORY_MAINTENANCE_DUE` | Store keeper, School admin | Preventive maintenance due within the alert days |
| `INVENTORY_WARRANTY_EXPIRING` | Store keeper, School admin | Warranty or AMC ends within the alert days |
| `INVENTORY_LOW_STOCK` | Store keeper, School admin | Every Monday, items at or below their reorder level |
| `INVENTORY_TICKET_RESOLVED` | Whoever reported the problem | Their repair ticket is resolved |

All templates are in English and Tamil (`notifications/inventory-templates.catalog.ts`, category `inventory`).

---

## 6. Status reference

| Record | Statuses |
|---|---|
| Asset | `in_store`, `allocated`, `in_maintenance`, `lost`, `disposed` |
| Asset condition | `new`, `good`, `fair`, `poor`, `damaged` |
| Allocation | `active`, `returned` |
| Transfer | `requested`, `approved`, `rejected`, `completed`, `cancelled` |
| Disposal | `requested`, `approved`, `rejected` |
| Maintenance ticket | `open`, `in_progress`, `resolved`, `cancelled` |
| Requisition | `pending`, `approved`, `rejected`, `issued`, `partly_issued`, `cancelled` |
| Stock movement | `receipt`, `issue`, `return`, `adjustment` |
| Audit | `open`, `closed`; findings `found`, `misplaced`, `not_available`, `unknown` |
| Warranty state | `active`, `expiring`, `expired`, `none` |

### Common error codes

| Code | Meaning |
|---|---|
| `ASSET_ALLOCATED` | Already allocated – take it back or transfer it |
| `ASSET_IN_MAINTENANCE` / `TICKET_OPEN` | Under repair / already has an open ticket |
| `ASSET_IN_TRANSFER` | Has an open transfer – approve, reject or cancel it first |
| `ASSET_LOST` / `ASSET_DISPOSED` | Marked lost / already disposed |
| `ASSET_HAS_HISTORY` | Cannot delete an asset with history – dispose of it instead |
| `NOT_ENOUGH_STOCK` | Issue is more than the store holds |
| `ASSETS_PENDING` | Staff member still holds assets |
| `AUDIT_OPEN` / `AUDIT_CLOSED` | Another verification is open / this audit is closed |
| `*_EXISTS` / `*_IN_USE` | Duplicate code / master still in use |
| `INVALID_SORT` | Unknown sort column |

---

## 7. Endpoint map

All under `/api/v1/admin/inventory` unless noted.

| Area | Endpoints |
|---|---|
| Dashboard and alerts | `GET dashboard`, `POST alerts/run` |
| Settings | `GET settings`, `PUT settings` |
| Masters | `categories`, `locations` (+ `POST locations/sync-rooms`), `departments` (+ `POST departments/sync`, `GET departments/{id}/assets`), `vendors`, `stores` – each with list, create, `PATCH {id}`, `DELETE {id}` |
| Assets | `GET assets/insights`, `GET assets`, `POST assets`, `GET/PATCH/DELETE assets/{id}`, `GET assets/{id}/history`, `POST assets/{id}/lost`, `POST assets/{id}/found`, `GET assets/lookup?code=`, `GET assets/labels`, `GET assets/import/template`, `POST assets/import` |
| Allocations | `GET allocations`, `POST allocations`, `POST allocations/return`, `POST allocations/{id}/acknowledge` |
| Transfers | `GET transfers`, `POST transfers`, `GET transfers/{id}`, `POST transfers/{id}/approve | reject | cancel` |
| Disposals | `GET disposals`, `POST disposals`, `POST disposals/{id}/approve | reject` |
| Maintenance | `GET/POST maintenance`, `GET/PATCH maintenance/{id}`, `POST maintenance/{id}/resolve | cancel`; `GET/POST schedules`, `PATCH schedules/{id}`, `POST schedules/{id}/start` |
| Stock | `GET stock/insights`; `stock/items` (list, create, get, `PATCH`, `DELETE`); `GET/POST stock/receipts`, `GET stock/receipts/{id}`; `POST stock/issues`; `POST stock/adjustments`; `GET stock/movements` |
| Requisitions | `GET/POST requisitions`, `GET requisitions/{id}`, `POST requisitions/{id}/approve | reject | issue | cancel` |
| Audits | `GET/POST audits`, `GET audits/{id}`, `POST audits/{id}/scan`, `GET audits/{id}/items`, `GET/PUT audits/{id}/count`, `POST audits/{id}/close` |
| Reports | `GET reports/assets?group_by=`, `reports/depreciation`, `reports/maintenance`, `reports/consumption`, `reports/stock-valuation`, `reports/register/export`, `reports/movements/export` |
| Staff | `GET /admin/staff/{id}/assets` |
| Self-service | `GET /me/assets`, `POST /me/assets/{allocationId}/acknowledge` |

---

## 8. Where the code lives

**API** (`school_management_system_api`)

| Path | Contents |
|---|---|
| `apps/school-api/src/modules/inventory/` | Module, controllers (`inventory.controller.ts`), services (assets, maintenance, stock, audits, reports, masters, alerts, notify, read), pure rules (`inventory.logic.ts`), Excel/label files (`inventory-files.ts`), unit tests (`inventory.spec.ts`) |
| `.../inventory/entities/` | `master.entity.ts`, `asset.entity.ts`, `operations.entity.ts` (24 tables) |
| `.../inventory/dto/` | `master.dto.ts`, `asset.dto.ts`, `operations.dto.ts` |
| `database/migrations/1795079799157-InventoryManagement.ts` | Creates the inventory tables |
| `database/seeds/demo-inventory.ts` | Demo data (run by `npm run seed:demo`) |
| `modules/notifications/inventory-templates.catalog.ts` | The 8 notification templates |
| `modules/access/access.catalog.ts` | `inventory.*` permissions and the Store Keeper role |

**Web** (`school_management_system_web`)

| Path | Contents |
|---|---|
| `src/features/inventory/api.ts` | Types, API calls, query hooks, permission helper |
| `src/features/inventory/pages/` | Inventory page (tabs), asset page, stock item page |
| `src/features/inventory/components/` | One file per tab plus the modals (allocate, return, transfer, ticket, receive, issue, requisition, disposal, import, labels…) and pickers |
| `src/features/staff/...` | The Assets tab on staff profiles |
| `src/config/nav.ts` | Sidebar entry "Inventory" |
