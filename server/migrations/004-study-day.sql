-- Preserve exact timestamps and scheduling memory. Only regroup daily totals.
-- Convert to local wall time before shifting the date, including across DST.
UPDATE reviews SET day = strftime('%Y-%m-%d', at, 'localtime', '-4 hours');
