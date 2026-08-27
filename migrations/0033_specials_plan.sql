-- 0033_specials_plan.sql
-- An advisor's Specials Program subscription, set by an admin once the advisor
-- pays. Controls whether the advisor can publish specials and how many can be
-- active at once. Values: NULL/'off' = no plan (specials disabled);
-- 'ten' = up to 10; 'twentyfive' = up to 25; 'unlimited'.
-- Written with a graceful fallback, so applying this is safe anytime.
ALTER TABLE users ADD COLUMN specials_plan TEXT;
