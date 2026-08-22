# Evaluation status: pending

No dataset or trained model was supplied with this repository, so no accuracy, loss, precision, recall, F1 score, confusion matrix, or class count is claimed here.

Run `python -m evaluation.evaluate` with a real, provenance-documented dataset
and its manifest-committed trained model. The command verifies the exact recorded
split/dataset, evaluates immutable hash-checked snapshots, stages measured
metrics/CSVs/plots, and publishes `evaluation_manifest.json` last. Treat results
as complete only when that manifest is present and all declared hashes match.
