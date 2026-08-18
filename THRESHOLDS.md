# Phase 2 Trigger Thresholds

Per §6 of the build spec, Phase 2 (Business Discovery API + ticket-link
resolution, affiliate injection, reminder re-evaluation) is gated on
observed usage. Do not scope Phase 2 work until at least one trigger
below has fired.

## Triggers (any one qualifies)

1. **Sustained volume:** ≥ 50 successful conversions per week for four
   consecutive weeks (rolling window).
2. **Quota pressure:** ≥ 20% of monthly-active users hit the free-tier
   monthly cap in a calendar month, for two consecutive months.
3. **Explicit demand:** ≥ 10 distinct users reply asking for a ticket
   link or reminder in a single month (raw-DM signal, tracked manually).

## Measurement

- Conversions and quota hits come from the `conversions` and `quota`
  D1 tables (§6 instrumentation).
- Weekly counts roll Monday–Sunday UTC.
- MAU = distinct `user_hash` with ≥ 1 conversion in the calendar month.

## Review cadence

Owner reviews these on the 1st of each month. If a trigger has fired,
open a design doc for the specific Phase 2 lever indicated (ticket
resolution vs. quota-driven upsell vs. reminders) — do not scope all
three at once.
