-- Run after migrations with:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/001_schema_contract.sql
-- This transaction always rolls back.
BEGIN;

DO $$
DECLARE
    missing_columns TEXT;
BEGIN
    SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
    INTO missing_columns
    FROM (
        VALUES
            ('crops', 'id'),
            ('crops', 'name'),
            ('crops', 'updated_at'),
            ('diseases', 'crop_id'),
            ('diseases', 'model_label'),
            ('diseases', 'content_status'),
            ('predictions', 'confidence'),
            ('predictions', 'model_version')
    ) AS required(table_name, column_name)
    LEFT JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
        AND actual.table_name = required.table_name
        AND actual.column_name = required.column_name
    WHERE actual.column_name IS NULL;

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Missing required schema columns: %', missing_columns;
    END IF;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO crops (name) VALUES ('');
        RAISE EXCEPTION 'Blank crop name was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO predictions (model_label, confidence, uncertain, model_version)
        VALUES ('test_label', 1.1, FALSE, 'test');
        RAISE EXCEPTION 'Out-of-range confidence was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO predictions (model_label, confidence, uncertain, model_version)
        VALUES ('test_label', 0.5, FALSE, 'invalid version!');
        RAISE EXCEPTION 'Invalid model version was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO diseases (crop_id, model_label, disease_name)
        VALUES (-1, 'test_invalid_fk', 'Invalid FK test');
        RAISE EXCEPTION 'Invalid crop foreign key was accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
END;
$$;

ROLLBACK;
