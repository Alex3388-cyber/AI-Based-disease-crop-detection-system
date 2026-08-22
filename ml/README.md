# Reproducible crop-disease ML pipeline

The pipeline deliberately stops short of claiming results because no real dataset or trained model was supplied. It uses exact-content SHA-256 grouping to prevent duplicate leakage, OpenCV for the same BGR-to-RGB preprocessing used by inference, and a practical MobileNetV2 transfer-learning baseline. The model choice is a baseline—not a claim that it outperforms alternatives.

Run commands from this `ml` directory with Python 3.11:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

For the integrity unit tests, install the development overlay and run:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest -q tests
```

## 1. Inspect real data

The expected layout is `dataset-root/<normalized_crop_disease>/*`. Supply actual provenance rather than placeholders:

```powershell
python -m tools.inspect_dataset `
  --dataset C:\path\to\dataset-root `
  --output work\inspection `
  --dataset-name "ACTUAL DATASET NAME" `
  --dataset-version "ACTUAL VERSION" `
  --source "ACTUAL URL OR REFERENCE" `
  --license "ACTUAL LICENSE"
```

Review `inspection_report.json`; resolve corrupt images and any identical content carrying conflicting labels before continuing.

## 2. Make a leakage-safe split

```powershell
python -m tools.split_dataset `
  --inventory work\inspection\inventory.json `
  --output work\split_manifest.json `
  --train 0.70 --validation 0.15 --test 0.15 --seed 2026

python -m tools.class_distribution `
  --input work\split_manifest.json `
  --output work\class_distribution.json
```

Exact duplicates are deduplicated by default. `--keep-duplicates` retains them but hash-groups them into one split, so identical bytes can never cross train/validation/test boundaries. The splitter is class-aware, but very small classes cannot be represented safely in every split; warnings are recorded in the manifest.

## 3. Train the baseline

```powershell
python -m training.train `
  --manifest work\split_manifest.json `
  --dataset C:\path\to\dataset-root `
  --artifacts artifacts `
  --model-version 1.0.0
```

Training verifies every source hash, then copies the train and validation files into a private temporary snapshot and verifies the copied bytes again. TensorFlow reads only that snapshot for every epoch, and the snapshot is removed whether training succeeds or fails. Training also fixes random seeds, enables deterministic TensorFlow operations where supported, uses class weights, early stopping, best-checkpoint saving, and learning-rate reduction. ImageNet weights may download on the first run; use `--weights none` only when that deliberate tradeoff is appropriate.

The default confidence threshold (`0.70`) is an operational starting configuration, not a scientifically validated value. Calibrate it from real validation/test behavior and domain review before deployment.

## 4. Evaluate on the untouched test split

```powershell
python -m evaluation.evaluate `
  --manifest work\split_manifest.json `
  --dataset C:\path\to\dataset-root `
  --artifacts artifacts `
  --output evaluation\results
```

Only this real run creates accuracy, loss, macro/weighted precision, recall, F1,
per-class metrics, predictions, training curves, and a confusion matrix. It first
copies a hash-verified, manifest-committed model release and untouched test set
into private snapshots, binds the exact training split and dataset version, then
stages every report. Trust a result directory only when
`evaluation_manifest.json` is present and its hashes match. Until then,
[evaluation/STATUS.md](evaluation/STATUS.md) remains explicitly pending.

## 5. Export to the Flask service

From this directory:

```powershell
python -m tools.export_bundle `
  --artifacts artifacts `
  --destination ..\ai-service\model
```

The exporter validates one manifest-committed training snapshot, stages it, and
publishes data files followed by a hash manifest. Flask verifies every runtime
hash before and after loading, so a partial publication never becomes ready.
`GET /ready` remains `MODEL_NOT_READY` if the bundle is absent or inconsistent.
