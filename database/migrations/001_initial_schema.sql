BEGIN;

CREATE TABLE crops (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    scientific_name VARCHAR(150),
    description TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT crops_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT crops_scientific_name_not_blank CHECK (
        scientific_name IS NULL OR length(btrim(scientific_name)) > 0
    )
);

CREATE UNIQUE INDEX crops_name_case_insensitive_uq ON crops (lower(name));
CREATE UNIQUE INDEX crops_scientific_name_case_insensitive_uq
    ON crops (lower(scientific_name))
    WHERE scientific_name IS NOT NULL;
CREATE INDEX crops_active_name_idx ON crops (active, name);

CREATE TABLE diseases (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    crop_id BIGINT NOT NULL,
    model_label VARCHAR(191) NOT NULL,
    disease_name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    symptoms TEXT NOT NULL DEFAULT '',
    management TEXT NOT NULL DEFAULT 'Recommendation pending expert/source validation.',
    prevention TEXT NOT NULL DEFAULT 'Recommendation pending expert/source validation.',
    source_reference TEXT,
    content_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT diseases_crop_fk FOREIGN KEY (crop_id)
        REFERENCES crops (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT diseases_model_label_uq UNIQUE (model_label),
    CONSTRAINT diseases_model_label_format CHECK (
        model_label ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT diseases_name_not_blank CHECK (length(btrim(disease_name)) > 0),
    CONSTRAINT diseases_content_status_check CHECK (
        content_status IN ('pending', 'validated', 'retired')
    ),
    CONSTRAINT diseases_source_not_blank CHECK (
        source_reference IS NULL OR length(btrim(source_reference)) > 0
    ),
    CONSTRAINT diseases_validated_content_has_review_metadata CHECK (
        content_status <> 'validated'
        OR (
            source_reference IS NOT NULL
            AND reviewed_at IS NOT NULL
            AND length(btrim(description)) > 0
            AND length(btrim(symptoms)) > 0
            AND length(btrim(management)) > 0
            AND length(btrim(prevention)) > 0
            AND management <> 'Recommendation pending expert/source validation.'
            AND prevention <> 'Recommendation pending expert/source validation.'
        )
    ),
    CONSTRAINT diseases_retired_content_inactive CHECK (
        content_status <> 'retired' OR active = FALSE
    )
);

CREATE UNIQUE INDEX diseases_crop_name_case_insensitive_uq
    ON diseases (crop_id, lower(disease_name));
CREATE INDEX diseases_crop_active_name_idx
    ON diseases (crop_id, active, disease_name);
CREATE INDEX diseases_active_model_label_idx
    ON diseases (active, model_label);

CREATE TABLE predictions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    disease_id BIGINT,
    model_label VARCHAR(191) NOT NULL,
    confidence NUMERIC(6, 5) NOT NULL,
    uncertain BOOLEAN NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT predictions_disease_fk FOREIGN KEY (disease_id)
        REFERENCES diseases (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT predictions_model_label_format CHECK (
        model_label ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    ),
    CONSTRAINT predictions_confidence_range CHECK (
        confidence >= 0 AND confidence <= 1
    ),
    CONSTRAINT predictions_model_version_format CHECK (
        model_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
    )
);

CREATE INDEX predictions_created_at_idx ON predictions (created_at DESC);
CREATE INDEX predictions_disease_created_at_idx
    ON predictions (disease_id, created_at DESC);
CREATE INDEX predictions_model_label_created_at_idx
    ON predictions (model_label, created_at DESC);

CREATE FUNCTION set_row_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER crops_set_updated_at
BEFORE UPDATE ON crops
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

CREATE TRIGGER diseases_set_updated_at
BEFORE UPDATE ON diseases
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

COMMENT ON TABLE predictions IS
    'Anonymous inference audit records. Raw images, filenames, locations, and user identifiers are intentionally not stored.';
COMMENT ON COLUMN diseases.model_label IS
    'Must exactly match one entry in the deployed model class_names.json.';
COMMENT ON COLUMN diseases.content_status IS
    'Only validated content may be presented as reviewed agricultural guidance.';

COMMIT;
