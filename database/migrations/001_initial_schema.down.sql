BEGIN;

DROP TRIGGER IF EXISTS diseases_set_updated_at ON diseases;
DROP TRIGGER IF EXISTS crops_set_updated_at ON crops;
DROP FUNCTION IF EXISTS set_row_updated_at();
DROP TABLE IF EXISTS predictions;
DROP TABLE IF EXISTS diseases;
DROP TABLE IF EXISTS crops;

COMMIT;
