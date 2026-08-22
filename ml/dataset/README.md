# Dataset location and provenance

No dataset is committed or assumed. Place an actual dataset outside version control using one normalized class folder per model output, for example `maize_healthy/` and `maize_leaf_blight/`. Do not use those examples as an assumed class list.

Before training, record the real dataset name, version, source URL/reference, and license with `tools.inspect_dataset`. Its generated inventory records actual file counts, corrupt files, dimensions, hashes, exact duplicates, and cross-label conflicts. Preserve the original source/license documentation alongside the private dataset.

Large or private image datasets should remain ignored by Git. Never merge unrelated datasets without separately documenting their provenance and compatible licenses.
