-- Mirrors normalizePagePath(): strip trailing slashes from the path part, keep '/' and the query.
UPDATE `comments`
SET `page_path` = CASE WHEN rtrim(`page_path`, '/') = '' THEN '/' ELSE rtrim(`page_path`, '/') END
WHERE instr(`page_path`, '?') = 0 AND `page_path` LIKE '%/' AND `page_path` <> '/';
--> statement-breakpoint
UPDATE `comments`
SET `page_path` =
  CASE WHEN rtrim(substr(`page_path`, 1, instr(`page_path`, '?') - 1), '/') = '' THEN '/'
       ELSE rtrim(substr(`page_path`, 1, instr(`page_path`, '?') - 1), '/') END
  || substr(`page_path`, instr(`page_path`, '?'))
WHERE instr(`page_path`, '?') > 0
  AND substr(`page_path`, 1, instr(`page_path`, '?') - 1) LIKE '%/'
  AND substr(`page_path`, 1, instr(`page_path`, '?') - 1) <> '/';
