# Generated artifacts

This directory contains no model and no fabricated evaluation results. A successful real training run writes:

- `best_model.keras`
- `class_names.json` in the exact output-index order
- `training_history.json` containing measured history
- `model_metadata.json` containing the exact preprocessing contract and provenance
- `artifact_manifest.json` binding all four files and the model version by SHA-256

The manifest is published last as the training-release commit marker. Export and
deployment reject loose or mixed files that do not match it. Generated binaries
and reports should be versioned through an intentional model-release process
rather than casually committed.
