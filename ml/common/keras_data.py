from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import numpy as np

from .image_pipeline import load_preprocessed
from .manifest import resolve_entry


def make_sequence(
    tensorflow: Any,
    *,
    entries: list[dict[str, str]],
    classes: list[str],
    dataset_root: Path,
    metadata: Mapping[str, Any],
    batch_size: int,
    shuffle: bool,
    seed: int,
):
    label_indices = {label: index for index, label in enumerate(classes)}

    class OpenCvSequence(tensorflow.keras.utils.Sequence):
        def __init__(self) -> None:
            super().__init__()
            self.indices = np.arange(len(entries), dtype=np.int64)
            self.epoch = 0
            if shuffle:
                self.on_epoch_end()

        def __len__(self) -> int:
            return int(np.ceil(len(entries) / batch_size))

        def __getitem__(self, batch_index: int) -> tuple[np.ndarray, np.ndarray]:
            selected = self.indices[
                batch_index * batch_size : (batch_index + 1) * batch_size
            ]
            images = np.empty(
                (
                    len(selected),
                    int(metadata["imageHeight"]),
                    int(metadata["imageWidth"]),
                    3,
                ),
                dtype=np.float32,
            )
            labels = np.empty(len(selected), dtype=np.int64)
            for output_index, entry_index in enumerate(selected):
                entry = entries[int(entry_index)]
                path = resolve_entry(dataset_root, entry["path"])
                images[output_index] = load_preprocessed(path, metadata)
                labels[output_index] = label_indices[entry["label"]]
            return images, labels

        def on_epoch_end(self) -> None:
            if shuffle:
                np.random.default_rng(seed + self.epoch).shuffle(self.indices)
            self.epoch += 1

    return OpenCvSequence()
