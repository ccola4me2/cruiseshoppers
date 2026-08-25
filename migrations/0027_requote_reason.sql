-- Why a client asked an advisor to revise their quote (shown to the advisor).
-- Also enables the reversible 'hold' status, which needs no schema change
-- (it's just a value in quote_offers.status).
ALTER TABLE quote_offers ADD COLUMN requote_reason TEXT;
