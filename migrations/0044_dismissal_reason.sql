-- 0044_dismissal_reason.sql
-- When an advisor chooses "No quote", let them leave a reason (e.g. the client
-- isn't a U.S. resident, or it's a cruise line they don't sell). Shown to admins
-- so the request can be routed to an advisor who can quote it. Optional/additive.
-- Apply in the D1 Console (cruiseshoppers database), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE advisor_lead_dismissals ADD COLUMN reason TEXT;
