-- 0036_lead_attribution.sql
-- Store where a lead came from (UTM parameters + referrer captured on the
-- visitor's first landing) as a JSON string, so the admin can see which channel
-- or person's shared link drove each quote request.
ALTER TABLE quote_requests ADD COLUMN attribution TEXT;
