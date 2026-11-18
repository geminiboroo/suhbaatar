-- Excel imports may contain more rights than the campaign's advertised capacity.
-- Keep manual transaction confirmation checks in the application, but do not block
-- administrator-approved bulk imports at the database trigger layer.
DROP TRIGGER IF EXISTS ticket_capacity;
