# RideSync front end: design

This document covers who the interface is for, what each screen does, how the screens look (wireframes), and the visual
system they share. The live version of the style guide is in the app at **`#/styleguide`**: it renders every component with the
same code the screens use.

| Screenshot | What it shows |
|---|---|
| [`styleguide.png`](styleguide.png) | The full style guide page |
| [`actor-switcher.png`](actor-switcher.png) | Header, navigation and the actor switcher open |
| [`mobile.png`](mobile.png) | The same system at 375 px |
| [`browse.png`](browse.png) | Browse: trips with filters, sortable table, plates and status badges |
| [`book-success.png`](book-success.png) | Book a ride: the result after booking, with the balance change and the audit row the trigger wrote |
| [`book-error.png`](book-error.png) | Book a ride: a second booking for the same rider, blocked by `idx_unique_active_rider_trip` (RS006) |
| [`audit.png`](audit.png) | Audit trail: running balance, totals, and a delete refused by the trigger (RS010) |
| [`mobile-book.png`](mobile-book.png) | Book a ride at 375 px |
| [`reviews.png`](reviews.png) | Reviews: `$facet` rating distribution, top tags, average rating, latest reviews and a readable VehicleMetadata document |

---

## 1. Users

RideSync is an operations console for a ride-hailing company. The database does the important work (atomic bookings, the audit
trigger, window functions, `$geoNear`, `$facet`), and the interface lets people use it and see what it did.

There is no login in this assignment. Instead, the header has an **actor switcher**: the operator picks the rider they are acting
for, and the screens that work on one rider's account use that choice.

| User | Who they are | What they need from RideSync | Main screens |
|---|---|---|---|
| **Operations agent** | Books rides on behalf of riders (phone bookings, corporate accounts) and keeps trips moving | Find a rider and a free car quickly, book, move the trip to *In transit* and *Completed*, understand at once why a booking failed | Book a ride, Browse, Map |
| **Finance and support** | Answers "why was I charged?" and checks wallet changes | One rider's full wallet history with the running balance; confidence that entries can't be edited | Audit trail, Browse |
| **Fleet analyst** | Watches vehicle performance and rider feedback | Revenue trends per vehicle, rankings, lifetime stats, rating patterns, each vehicle's details | Analytics, Reviews, Map |

All three are at a desk on a laptop, so the layout is designed for 1280 px first. Every screen still works at 375 px, for a
supervisor checking on a phone.

### What each user does (and the API behind it)

| Task | User | Screen | API |
|---|---|---|---|
| Pick the rider to act for | Operations, Finance | Header | `GET /api/riders?q=` |
| See who and what exists, filter, open details | All | Browse | `GET /api/riders`, `/vehicles`, `/trips` (+ `/:id`) |
| Book a ride and see the wallet deduction | Operations | Book a ride | `POST /api/trips` |
| Understand a failed booking (busy rider or car, no balance, car out of service) | Operations | Book a ride | RS003, RS004, RS006, RS007 |
| Move a trip forward | Operations | Book a ride, trip detail | `PATCH /api/trips/:id/status` |
| Top up a wallet | Operations, Finance | Book a ride | `POST /api/riders/:id/top-up` |
| Trace every wallet change of a rider | Finance | Audit trail | `GET /api/riders/:id/audit` |
| Show that the log can't be changed | Finance | Audit trail | `DELETE /api/audit/:id` → 403 RS010 |
| Compare vehicle revenue over time | Analyst | Analytics | `GET /api/analytics/moving-average`, `/ranking` |
| Refresh the lifetime statistics | Analyst | Analytics | `POST /api/analytics/vehicle-stats/refresh` |
| Find free cars near a pickup point | Operations | Map | `GET /api/map/nearest`, `/map/stream` |
| See what riders say about a car | Analyst | Reviews | `GET /api/reviews/summary`, `/reviews`, `/vehicles/:id/catalog` |

---

## 2. Screens and navigation

```
Header:  [plate] RideSync   Browse  Book a ride  Audit trail  Analytics  Map  Reviews     ● Databases online   [Acting as Priya Iyer ₹10,803.50 ▾]
```

The navigation follows the order of a demo: look around, book, check the money trail, then the analytics and MongoDB screens.

| URL | Screen | Phase |
|---|---|---|
| `#/` | redirects to `#/browse` | 3 |
| `#/browse/riders`, `/vehicles`, `/trips` | Browse lists (filters and page in the query string) | 4 |
| `#/browse/riders/:id`, `/vehicles/:id`, `/trips/:id` | Detail views | 4 |
| `#/book` | Book a ride | 4 |
| `#/audit?from=&to=&action=&page=` | Audit trail of the current rider | 4 |
| `#/analytics?from=&to=&topN=` | Analytics | 5 |
| `#/map?origin=&radius=` | Map | 5 |
| `#/reviews?vehicleId=&rating=` | Reviews | 5 |
| `#/styleguide` | Live style guide (linked from the footer) | 3 |
| anything else | "Page not found" with a way back | 3 |

**Why a hash router:** Express serves `web/` as plain static files, so `#/…` URLs need no server routing. Filters, page numbers
and tabs live in the query string, so a reload or a shared link reopens the same view, and the browser's Back button works.
When the screen changes, focus moves to the new page heading so keyboard and screen-reader users land on the new content.

---

## 3. Wireframes

The boxes show layout and hierarchy, not exact sizes. `[ ]` is a control, `( )` is a status badge, and `▮MH12AB1004▮` is a
licence plate chip.

### Browse

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Browse                                                                       │
│ Riders, vehicles and trips.                     [ Riders | Vehicles | Trips ]│
├──────────────────────────────────────────────────────────────────────────────┤
│ Status [Any ▾]  Rider [search…]  From [date]  To [date]        [Clear filters]│
├──────────────────────────────────────────────────────────────────────────────┤
│ Trip      Rider        Vehicle        Status         Fare ↓    Booked        │
│ 2d166ba3  Rider_0042   ▮MH12AB1004▮   (Requested)   ₹250.00   2 min ago     │
│ 8a51c0e4  Rider_0007   ▮MH04AB1031▮   (In transit)  ₹412.50   19 min ago    │
│ …                                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ 21–40 of 100,030                          [Previous]  Page 2 of 5,002  [Next] │
└──────────────────────────────────────────────────────────────────────────────┘
```

Detail views (rider, vehicle, trip) use a two-column layout: facts (`kv` list) on the left, and related items (active trip, last
wallet change, linked audit row) on the right. They stack to one column on narrow screens.

### Book a ride (Workflow 1)

```
┌───────────────────────────────────────┬──────────────────────────────────────┐
│ Book a ride for Priya Iyer            │ Wallet                               │
│                                       │ ₹10,803.50                           │
│ Vehicle  [search plate… ▾]            │ [Amount ₹    ] [Top up wallet]       │
│          only bookable cars listed    │                                      │
│ Fare     [₹ 250      ]                │ Active trip                          │
│                                       │ ▮MH12AB1004▮ (Requested) ₹250.00     │
│ [Book ride]                           │ [Start trip] → [Complete trip]       │
├───────────────────────────────────────┴──────────────────────────────────────┤
│ ✓ Ride booked. ₹250.00 taken from the wallet: ₹11,053.50 → ₹10,803.50        │
│   New audit entry: FARE_DEDUCTION −₹250.00, linked to trip 2d166ba3          │
│ — or —                                                                       │
│ ! Rider already has an active trip                                           │
│   A rider can only have one trip that is REQUESTED or IN TRANSIT. …           │
│   Code RS006   Blocked by idx_unique_active_rider_trip                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- With no rider selected, the form is replaced by "Choose a rider first", pointing at the header switcher.
- The result area shows the before and after balance and the new audit row, which proves the atomic deduction.
- On a failure, it shows the database's reason and the index or constraint that fired, and states that nothing was charged.
- To demonstrate RS006 and RS007, the screen also offers booking a car that's already busy, or a second trip for the same rider.
  The UI doesn't hide the failure cases; it explains them.

### Audit trail

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Audit trail: Priya Iyer                     Wallet now ₹10,803.50            │
├──────────────────────────────────────────────────────────────────────────────┤
│ From [date] To [date]  Type [All ▾]                                          │
│ ┌─────────────┬────────────┬────────────┬──────────────┐                     │
│ │ Top-ups  3  │ ₹1,500.00  │ Fares  12  │ −₹3,120.00   │  (for these filters)│
│ └─────────────┴────────────┴────────────┴──────────────┘                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ When          Type             Change      Before      After      Trip       │
│ 15 Oct 10:42  Fare deduction   −₹250.00   ₹11,053.50  ₹10,803.50  2d166ba3   │
│ 15 Oct 10:40  Top-up           +₹500.00   ₹10,553.50  ₹11,053.50  —          │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1–20 of 214                                          [Previous]  [Next]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Each row has a "Try to delete" action that calls `DELETE /api/audit/:id` and shows the 403 RS010 response. It demonstrates the
append-only trigger without any risk, because the API always rolls back.

### Analytics (Workflow 2 and the materialized view)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Analytics                            From [date] To [date]  Top [5 ▾]        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Riders 1,000 │ Bookable 65 │ In transit 10 │ Revenue today ₹14.9L            │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ 7-day moving average of revenue               │ Ranking on 15 Oct            │
│  (line chart, one line per top vehicle)       │ 1 ▮MH09AB1009▮ ₹1,071.74     │
│                                               │ 2 ▮MH03AB1003▮ ₹890.69       │
├───────────────────────────────────────────────┴──────────────────────────────┤
│ Lifetime vehicle stats (materialized view)                                   │
│ ! 3 new trips are not counted yet. Last refreshed 10:31.     [Refresh stats] │
│ Rank  Vehicle        Class   Trips  Completed  Earnings                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

The stale-data notice uses the API's `freshness.tripsNotInView`. It makes the materialized view's behaviour visible: book a ride,
watch the count rise, refresh, and watch it return to zero.

### Map (Workflow 3)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Map        Pickup [Dadar station ▾]        Radius [5 km ▾]   ● Live (3 s)  │
├───────────────────────────────────────────────┬──────────────────────────────┤
│                                               │ Nearest available            │
│   (Leaflet map: pickup pin, 5 km circle,      │ 1 ▮MH07AB1007▮ 0.41 km [Book]│
│    available cars solid, busy cars hollow)    │ 2 ▮MH22AB1022▮ 0.88 km [Book]│
│                                               │ 65 available · 30 busy       │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

"Book" appears only when the API says `bookable: true`, which is checked against PostgreSQL. The live label shows whether the
stream uses change streams or polling. If both fail, it falls back to manual refresh.

### Reviews (Workflow 4)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Reviews                          Vehicle [All ▾]  From [date]  To [date]     │
├──────────────────────┬───────────────────────────┬───────────────────────────┤
│ Average 3.84 / 5     │ Ratings (5 bars, 5 → 1)   │ Common feedback (top tags)│
│ 100,000 reviews      │                           │                           │
├──────────────────────┴───────────────────────────┴───────────────────────────┤
│ Latest reviews (rating, tags, rider, vehicle, date)   [filter by rating]     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Vehicle catalog: the VehicleMetadata document (specs, inspection history)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Style guide

### Direction

A ride-hailing console lives on the road, so the visual language comes from roads: **asphalt** ink, **road-marking** off-white
pages, and the **yellow commercial licence plate** that every Indian taxi carries. The plate is the one bold element. Every
vehicle in the app is shown as a plate chip, so a car is recognisable at a glance in a table, on the map, in a ranking or in an
error. Plate yellow is used for nothing else, so it always means "a vehicle".

Everything around the plate stays quiet: white panels, one ink colour for text and primary actions, thin dividers, and no
gradients or decorative shadows. Colour otherwise appears only where it carries meaning: trip status, money in versus money out,
and feedback.

Principles:
1. **Show the database's reason.** A failed booking names the index or constraint that fired, and says what to do next.
2. **One primary action per screen**, in ink. Everything else is a secondary or ghost button.
3. **Never colour alone.** Status badges have a word and a dot shape; signed money has a + or − sign.
4. **Numbers line up.** Tabular figures everywhere, and money is right-aligned in tables.
5. **State in the URL.** Filters and pages survive reloads and can be shared.

### Colour

All values are defined once in `web/css/tokens.css`. Contrast ratios are WCAG 2.1 ratios, computed from the hex values.

| Token | Hex | Used for | Contrast |
|---|---|---|---|
| `--paper` | `#f4f6f5` | Page background | |
| `--surface` | `#ffffff` | Panels, tables, inputs | |
| `--surface-sunk` | `#eef1f0` | Table header, hover, code | |
| `--ink` | `#1c2a33` | Text, primary button | 13.5:1 on paper, 14.7:1 on white |
| `--ink-2` | `#4a5963` | Secondary text | 6.7:1 on paper, 6.4:1 on sunk |
| `--ink-3` | `#627078` | Hints, placeholders | 5.1:1 on white, 4.7:1 on paper, 4.5:1 on sunk |
| `--line` | `#c9d1ce` | Dividers (decorative) | |
| `--line-strong` | `#8a969c` | Input borders | 3.0:1 on white (non-text, WCAG 1.4.11) |
| `--plate` / `--plate-ink` | `#f4c21b` / `#15191c` | Licence plates only | 10.6:1 |
| `--requested` on `--requested-bg` | `#2a55a0` / `#e6edf8` | Requested, links, focus ring | 6.1:1 (link on paper 6.7:1) |
| `--transit` on `--transit-bg` | `#0c6e55` / `#dff1ea` | In transit, credits, success | 5.3:1 (credit on white 6.2:1) |
| `--completed` on `--completed-bg` | `#535f68` / `#ecefee` | Completed | 5.7:1 |
| `--debit` / `--danger` on `--danger-bg` | `#a61f26` / `#fbeaea` | Debits, errors | 6.3:1 (debit on white 7.4:1) |
| `--warn` on `--warn-bg` | `#7a4b00` / `#fff4d6` | Warnings, out of service, stale data | 6.8:1 |

Every text pairing meets WCAG AA (4.5:1). While writing this document, `--ink-3` was darkened from `#6b7880` (4.2:1 on paper)
to `#627078`.

### Type

- **Barlow** for text and **Barlow Condensed** for headings and figures, from Google Fonts. Barlow's shapes come from Californian
  road signs, and the condensed cut fits plates and big figures in narrow columns.
- Offline, the stack falls back to Segoe UI or system-ui, and the layout doesn't depend on the exact face.
- The scale is a 1.2 ratio from 15 px: 13, 14, **15 (body)**, 18, 22, 30, 40 px.
- Line height is 1.5 for text and 1.15 for headings. Paragraphs are at most 72 characters wide.
- `font-variant-numeric: tabular-nums` is set on the body, so figures align in every table.
- Headings use sentence case. There are no all-caps labels.

### Space, shape, motion

- **Spacing:** a 4 px grid (`--s-1` 4 px … `--s-8` 64 px). Panels use 24 px padding and table cells 10 × 16 px.
- **Radius grows with the size of the element:** plate 3 px, controls 6 px, panels 10 px, pills 999 px.
- **Motion:** only where something changed. A new table row flashes once, toasts slide in, and the *In transit* dot pulses
  because the trip is live. `prefers-reduced-motion` turns all of it off.
- **Breakpoint:** 860 px. Below it, the header wraps and the navigation becomes a scrollable row, and grids collapse to one column.

### Voice

- Buttons say exactly what happens: "Book ride", "Top up wallet", "Complete trip", "Refresh stats". The toast that follows uses
  the same verb: "Ride booked", "Wallet topped up".
- Errors say what happened and how to fix it, with no apology: "The fare is more than the rider's wallet balance, so nothing was
  charged and no trip was created. Top up the wallet or lower the fare."
- Empty states invite the next step: "No trips on these dates. Widen the date range or clear the filters."

---

## 5. Components

The code is in `web/js/components/` and the CSS in `web/css/components.css`. Each component below is shown on the live
style guide in every state listed.

| Component | Code | States | Notes |
|---|---|---|---|
| Licence plate | `plate()` | default, large, out of service | The signature element |
| Status badge | `statusBadge()` | Requested, In transit (pulsing dot), Completed, Out of service | Dot shape differs as well as colour |
| Money | `money()` | plain, signed credit (green +), signed debit (red −) | INR, 2 decimals, true minus sign |
| Button | `button()`, `busy()` | primary, secondary, ghost, danger, small, disabled, busy | Busy shows a spinner and new label, and blocks double submits |
| Form field | `field()`, `input()`, `select()` | default, hint, invalid (message from the API's `fieldErrors`) | Label `for`, `aria-describedby`, `aria-invalid` |
| Error alert | `errorAlert()` | API error, with code and blocking index or constraint, optional "Try again" | `role="alert"` |
| Notice | `notice()` | ok, warn, info | `role="status"` |
| Toast | `toast()` | info, error; auto-dismiss after 5 s, dismiss button | Only confirms success. An error that needs action stays inline. |
| Confirmation dialog | `confirmDialog()` | confirm, cancel (button, Escape, backdrop) | Native `<dialog>`, which traps focus |
| Data table | `dataTable()` | sortable headers (`aria-sort`), row links, new-row flash, horizontal scroll on small screens | First cell is a real link, so rows work with the keyboard |
| Pager | `pager()` | first, middle, last page, empty | "21–40 of 1,000" is announced politely |
| Panel | `panel()` | with or without head, flush (tables), footer | |
| Figures | `figures()` | 2–6 tiles | Headline numbers |
| Key/value list | `kv()` | | Detail views |
| Loading / empty | `skeleton()`, `empty()` | | Skeletons keep the layout still |
| Health badge | `healthBadge()` | Databases online / MongoDB offline / PostgreSQL offline / API offline | Polls `/api/health` every 30 s |
| Actor switcher | `actorSwitcher()` | none selected, selected, open, searching, no match, load error | See below |

### Actor switcher

- **Closed,** it shows "Acting as **Priya Iyer** ₹10,803.50", or "Choose a rider" when no one is selected.
- **Open,** it has a search box (name or pasted rider id), "By name" or "Lowest balance" ordering, and the three most recent riders
  at the top.
  - "Lowest balance" makes it quick to set up the insufficient-balance (RS004) demo.
- **Keyboard:** Enter or Space opens it with focus in the search box. ↑ and ↓ move through the list (`aria-activedescendant`),
  Enter picks, and Escape closes and returns focus to the button. Clicking outside also closes it.
- The choice is kept in `localStorage`, wrapped so a blocked storage never breaks the app.
- On start, the rider is re-read from the API, so the balance is current. If the rider no longer exists (the database was
  re-seeded), the choice is cleared and a toast explains why.
- After a booking or top-up, the screens call `refreshActor()`, so the header balance always matches the database.

---

## 6. Errors and empty states

Where each API error appears and what the user can do about it:

| Error | Where it shows | What the UI offers |
|---|---|---|
| `VALIDATION` (400) | Under the field named in `fieldErrors`; focus moves to the first invalid field | Fix the value |
| `RS001` rider not found | Inline on the screen and as a toast on start | Choose another rider |
| `RS002`, `RS003` vehicle missing or out of service | Inline above the booking form | Pick another vehicle (only bookable ones are listed) |
| `RS004` insufficient balance | Inline, naming `CHECK (wallet_balance >= 0)` | "Top up wallet" right next to it |
| `RS006` rider busy | Inline, naming `idx_unique_active_rider_trip` | Link to the rider's active trip, to complete it |
| `RS007` vehicle busy | Inline, naming `idx_unique_active_vehicle_trip` | Choose another vehicle |
| `RS008` trip not found | Trip detail | Back to trips |
| `RS009` status change not allowed | Inline next to the status buttons | Only the next valid step is offered as a button |
| `RS010` audit log is read-only | Inline on the audit row | Nothing: this is the expected outcome of the demo action |
| `DB_UNAVAILABLE` (503) | Inline in the panel that needed the database; the header badge turns amber | "Try again" |
| `NETWORK` | Inline, and the header badge says "API offline" | "Try again"; the message says to check `npm run dev` |
| Unknown route | "Page not found" page | "Go to Browse" |

Empty states always name the next step, such as "No trips on these dates. Widen the date range or clear the filters." Lists show
skeleton rows while loading, so the page doesn't jump.

---

## 7. Accessibility

- Semantic structure: one `<h1>` per screen, landmarks (`header`, `nav`, `main`, `footer`), and a "Skip to content" link.
- Every control can be reached and used with the keyboard. A visible 2 px focus ring uses `--focus` (7.2:1 on white).
- Focus moves to the new page heading after navigation. Dialogs trap focus and return it when closed.
- Forms use `<label for>`. Hints and errors are linked with `aria-describedby`, and invalid fields get `aria-invalid`.
- Live regions: the toasts, the health badge, the pager count and the actor search results.
- Tables use `<th scope>`, sortable headers expose `aria-sort`, and every table has a caption for screen readers.
- Colour is never the only signal (see the principles). All text meets WCAG AA contrast.
- `prefers-reduced-motion` turns off every animation. There's no horizontal page scroll at 375 px, because wide tables scroll
  inside their panel.

---

## 8. Code structure

```
web/
  index.html            app shell: header, <main>, footer, loads js/app.js
  css/
    tokens.css          every colour, size, radius, duration (this document, section 4)
    base.css            reset, type, header, page layout, utilities
    components.css      one block per component (section 5)
  js/
    app.js              navigation, routes, header (health badge + actor switcher), start
    lib/
      dom.js            h() element builder (text only, never innerHTML), mount, debounce, safe storage
      api.js            fetch wrapper; errors become ApiError { status, code, title, message, fieldErrors, constraint, … }
      router.js         hash router: params, query, abort signal per screen, focus management
      store.js          the actor (selected rider), persisted, with change events
    components/         ui.js, table.js, toast.js, dialog.js, health.js, actor.js
    screens/            one module per screen: { title, nav, render(ctx) → cleanup }
shared/                 constants, error catalogue, formatting: the same files the API uses
```

- **No framework and no build step.** The browser loads ES modules directly from Express, and Chart.js and Leaflet come from
  `node_modules` at `/vendor/…`.
- `render(ctx)` gets an `AbortSignal` that fires when the user leaves the screen. Fetches pass it on, so a slow response never
  paints into the next screen.
- Text from the API is always inserted as text (`h()` uses text nodes), so database content can't inject HTML.
