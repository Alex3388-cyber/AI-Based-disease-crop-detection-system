# Inference artifacts

This directory intentionally contains no trained model or claimed results. Copy a validated export here with exactly these names:

- `best_model.keras`
- `class_names.json`
- `model_metadata.json`
- `training_history.json`
- `bundle_manifest.json` containing SHA-256 hashes for the coherent release

Until a complete, hash-verified compatible bundle is present, authenticated `GET /ready` and predictions safely report `MODEL_NOT_READY`. Publish with `ml/tools/export_bundle.py`, then restart the inference service to load the release.
