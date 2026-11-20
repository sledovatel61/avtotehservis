-- 002_service_price.sql — круг 26: колонка «цена от» у услуг + чистка слагов, которых больше нет.
-- Идемпотентна через журнал schema_migrations (apply один раз).
--
-- 1) price_from: в схеме услуг не было колонки для цены «от» (задание №30 §2.2, вариант A).
--    TEXT, NULL допустим: карточка без цены просто не выводит блок (обратная совместимость).
ALTER TABLE services ADD COLUMN price_from TEXT;

-- 2) Чистка слагов, удалённых из каталога и чипов решениями владельца (05.11.2026):
--    грузового шиномонтажа и правки/прокатки дисков нет; hodovaya-tormoza разделена на
--    tormoza и podveska; elektrika стала diagnostika; remont-shin влит в balansirovka;
--    остальные скрытые чипы (хранение шин, развал-схождение, рейки, двигатель, АКПП, стёкла,
--    старое имя kondicionery) не подтверждены прайсом и удалены из seed-data.
--    FK на services нет ни у одной таблицы: cases.service_slug — TEXT (кейсы переназначает
--    сид в том же прогоне), leads.services_json — TEXT (исторические записи не ломаются).
DELETE FROM services WHERE slug IN (
  'shinomontazh-gruz', 'pravka-diskov', 'hodovaya-tormoza', 'elektrika', 'remont-shin',
  'porezy-gryzhi', 'vulkanizaciya', 'hranenie-shin', 'razval-shozhdenie',
  'rulevye-reyki', 'dvigatel', 'akpp-mkpp', 'stekla', 'kondicionery'
);
