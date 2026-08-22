-- 010_category_rename_anschaffungen.sql
-- Zwei Umbenennungen und eine neue Unterkategorie.
--
-- Bewusst UPDATE statt DELETE + INSERT: die Kategorie-ID bleibt erhalten,
-- damit bestehende Buchungen ihre Zuordnung behalten. Ein Neuanlegen wuerde
-- jede bisherige Buchung auf eine ID zeigen lassen, die es nicht mehr gibt.

-- "Kleidung" -> "Kleidung & Schuhe". Der Elternbezug steht mit in der
-- Bedingung, damit nicht versehentlich eine gleichnamige Unterkategorie
-- unter einer anderen Oberkategorie mitumbenannt wird.
UPDATE categories
   SET name = 'Kleidung & Schuhe'
 WHERE name = 'Kleidung'
   AND parent_id = (SELECT id FROM categories WHERE name = 'Persönlich' AND parent_id IS NULL);

-- "Online Shopping" -> "Anschaffungen". Online Shopping ist der Kanal, ueber
-- den gekauft wird, keine Ausgabenart — die Auswertung zeigte damit einen
-- Sammelposten ohne Aussage (Kabel, Kleinkram, Haushalt, Technik).
UPDATE categories
   SET name = 'Anschaffungen'
 WHERE name = 'Online Shopping'
   AND parent_id = (SELECT id FROM categories WHERE name = 'Persönlich' AND parent_id IS NULL);

-- Neue Unterkategorie unter Lebensmittel, hinter Einkauf (10) und
-- Essen gehen (20).
INSERT INTO categories (name, parent_id, sort_order)
SELECT 'Kantine/Mittag', id, 30
FROM categories
WHERE name = 'Lebensmittel' AND parent_id IS NULL;
