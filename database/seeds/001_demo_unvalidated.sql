-- DEMO / UNVALIDATED CONTENT ONLY.
-- These inactive records exercise administration and database flows. They do not
-- claim model support and are not returned by the public active-only API.
BEGIN;

INSERT INTO crops (name, scientific_name, description, active)
VALUES (
    'DEMO crop (inactive)',
    NULL,
    'DEMO / UNVALIDATED CONTENT. Replace this record after reviewing the real dataset.',
    FALSE
)
ON CONFLICT DO NOTHING;

INSERT INTO diseases (
    crop_id, model_label, disease_name, description, symptoms, management,
    prevention, source_reference, content_status, active
)
SELECT
    id,
    'demo_unvalidated_placeholder',
    'DEMO disease placeholder (inactive)',
    'DEMO / UNVALIDATED CONTENT. No diagnosis information has been reviewed.',
    'DEMO / UNVALIDATED CONTENT. Symptoms pending expert/source validation.',
    'Recommendation pending expert/source validation.',
    'Recommendation pending expert/source validation.',
    NULL,
    'pending',
    FALSE
FROM crops
WHERE name = 'DEMO crop (inactive)'
ON CONFLICT (model_label) DO NOTHING;

COMMIT;
