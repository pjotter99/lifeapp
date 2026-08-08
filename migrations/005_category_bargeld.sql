-- 005_category_bargeld.sql
-- Neue Unterkategorie "Bargeld" unter "Sonstiges". Normale Ausgabe wie jede
-- andere Unterkategorie — is_transfer bleibt 0, das ist kein Transfer-Posten
-- (Bargeldabhebung wird als Ausgabe erfasst, nicht als Kontoumbuchung).

INSERT INTO categories (name, parent_id, sort_order)
SELECT 'Bargeld', id, 30
FROM categories
WHERE name = 'Sonstiges' AND parent_id IS NULL;
