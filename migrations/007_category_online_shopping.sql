-- 007_category_online_shopping.sql
-- Neue Unterkategorie "Online Shopping" unter "Persönlich". Normale Ausgabe
-- wie jede andere Unterkategorie.

INSERT INTO categories (name, parent_id, sort_order)
SELECT 'Online Shopping', id, 60
FROM categories
WHERE name = 'Persönlich' AND parent_id IS NULL;
