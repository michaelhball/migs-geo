UPDATE places
SET data = json_set(data, '$.kind', 'lake')
WHERE id IN ('aral-sea', 'dead-sea', 'caspian-sea', 'sea-of-galilee')
  AND json_extract(data, '$.kind') = 'water';
