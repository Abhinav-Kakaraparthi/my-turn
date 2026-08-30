from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
from pathlib import Path

import numpy as np
import pandas as pd


LIP_INDICES = (
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
    291, 146, 91, 181, 84, 17, 314, 405, 321, 375,
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
    95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
)
POSE_INDICES = (11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22)
HAND_INDICES = tuple(range(21))

TARGET_FRAME_COUNT = 64
LANDMARK_COUNT = 94
CHANNEL_COUNT = 4
LEFT_SHOULDER_OFFSET = 61
RIGHT_SHOULDER_OFFSET = 62
MINIMUM_SCALE = 0.0001
EXPECTED_HELLO_SEQUENCE = 1738393236
EXPECTED_HELLO_SHA256 = (
    "24d14494f77c4e4ddde76793f960fcde2a8e589ed09b420220b1b78b51f3ac8f"
)

GROUPS = (
    ("face", 0, LIP_INDICES),
    ("left_hand", 40, HAND_INDICES),
    ("pose", 61, POSE_INDICES),
    ("right_hand", 73, HAND_INDICES),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build compact browser practice references from Kaggle ASL landmarks."
    )
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def read_selected_frames(parquet_path: Path) -> np.ndarray:
    data = pd.read_parquet(
        parquet_path,
        columns=("frame", "type", "landmark_index", "x", "y", "z"),
    )
    frame_numbers = sorted(int(value) for value in data["frame"].unique())
    if len(frame_numbers) < 2:
        raise ValueError(f"{parquet_path.name} contains fewer than two frames")

    frame_positions = {number: index for index, number in enumerate(frame_numbers)}
    values = np.zeros(
        (len(frame_numbers), LANDMARK_COUNT, CHANNEL_COUNT),
        dtype=np.float32,
    )

    for type_name, target_offset, source_indices in GROUPS:
        source_to_target = {
            source_index: target_offset + group_index
            for group_index, source_index in enumerate(source_indices)
        }
        selected = data[
            data["type"].eq(type_name)
            & data["landmark_index"].isin(source_indices)
        ]

        for row in selected.itertuples(index=False):
            coordinates = (float(row.x), float(row.y), float(row.z))
            if not all(math.isfinite(value) for value in coordinates):
                continue

            frame_position = frame_positions[int(row.frame)]
            landmark_position = source_to_target[int(row.landmark_index)]
            values[frame_position, landmark_position, :3] = coordinates
            values[frame_position, landmark_position, 3] = 1

    return values


def preprocess_frames(values: np.ndarray) -> np.ndarray:
    valid_shoulders = (
        (values[:, LEFT_SHOULDER_OFFSET, 3] == 1)
        & (values[:, RIGHT_SHOULDER_OFFSET, 3] == 1)
    )
    if not valid_shoulders.any():
        raise ValueError("No frames contain both shoulder landmarks")

    left_shoulders = values[valid_shoulders, LEFT_SHOULDER_OFFSET, :3]
    right_shoulders = values[valid_shoulders, RIGHT_SHOULDER_OFFSET, :3]
    centers = (left_shoulders.astype(np.float64) + right_shoulders) / 2
    widths = [
        math.hypot(
            *(float(left[axis]) - float(right[axis]) for axis in range(3))
        )
        for left, right in zip(left_shoulders, right_shoulders, strict=True)
    ]
    center = np.array(
        [statistics.median(centers[:, axis].tolist()) for axis in range(3)],
        dtype=np.float64,
    )
    scale = statistics.median(widths)
    if not math.isfinite(scale) or scale < MINIMUM_SCALE:
        raise ValueError("The median shoulder width is invalid")

    source_count = values.shape[0]
    source_indices = np.floor(
        np.arange(TARGET_FRAME_COUNT, dtype=np.float64)
        * (source_count - 1)
        / (TARGET_FRAME_COUNT - 1)
        + 0.5
    ).astype(np.int64)
    selected = values[source_indices]
    mask = selected[:, :, 3] == 1
    coordinates = np.clip(
        (selected[:, :, :3].astype(np.float64) - center) / scale,
        -5,
        5,
    )

    output = np.zeros(
        (TARGET_FRAME_COUNT, LANDMARK_COUNT, CHANNEL_COUNT),
        dtype=np.float32,
    )
    output[:, :, :3] = np.where(mask[:, :, None], coordinates, 0)
    output[:, :, 3] = mask.astype(np.float32)
    return output


def safe_filename(sign: str) -> str:
    filename = re.sub(r"[^a-z0-9]+", "-", sign.lower()).strip("-")
    if not filename:
        raise ValueError(f"Cannot create a filename for sign {sign!r}")
    return filename


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    with args.selection.open("r", encoding="utf-8-sig", newline="") as handle:
        selections = sorted(csv.DictReader(handle), key=lambda row: row["sign"])

    if len(selections) != 250:
        raise ValueError(f"Expected 250 selected signs, found {len(selections)}")

    references: list[dict[str, object]] = []
    seen_filenames: set[str] = set()
    hello_hash_matches: bool | None = None

    for position, selection in enumerate(selections, start=1):
        sign = selection["sign"]
        sequence_id = int(selection["sequence_id"])
        participant_id = int(selection["participant_id"])
        parquet_path = args.raw_dir / Path(selection["path"]).name
        if not parquet_path.is_file():
            raise FileNotFoundError(parquet_path)

        source_values = read_selected_frames(parquet_path)
        normalized = preprocess_frames(source_values)
        filename = f"{safe_filename(sign)}.bin"
        if filename in seen_filenames:
            raise ValueError(f"Duplicate output filename: {filename}")
        seen_filenames.add(filename)

        payload = normalized.astype("<f4", copy=False).tobytes(order="C")
        sha256 = hashlib.sha256(payload).hexdigest()
        (args.output_dir / filename).write_bytes(payload)

        if sign == "hello" and sequence_id == EXPECTED_HELLO_SEQUENCE:
            hello_hash_matches = sha256 == EXPECTED_HELLO_SHA256

        references.append(
            {
                "sign": sign,
                "file": filename,
                "participantId": participant_id,
                "sequenceId": sequence_id,
                "sourceFrameCount": int(source_values.shape[0]),
                "sha256": sha256,
            }
        )

        if position % 25 == 0 or position == len(selections):
            print(f"Converted {position}/{len(selections)} references")

    index = {
        "schemaVersion": 2,
        "dtype": "float32-little-endian",
        "shape": [TARGET_FRAME_COUNT, LANDMARK_COUNT, CHANNEL_COUNT],
        "normalization": {
            "center": "median shoulder center",
            "scale": "median shoulder width",
            "coordinateClip": [-5, 5],
        },
        "landmarkGroups": {
            "lips": 40,
            "leftHand": 21,
            "pose": 12,
            "rightHand": 21,
        },
        "source": {
            "name": "Google - Isolated Sign Language Recognition",
            "dataset": "PopSign ASL landmark dataset",
            "url": "https://www.kaggle.com/competitions/asl-signs",
            "terms": "Use is subject to the Kaggle competition rules and dataset terms.",
        },
        "references": references,
    }
    (args.output_dir / "index.json").write_text(
        json.dumps(index, indent=2) + "\n",
        encoding="utf-8",
    )

    total_bytes = sum((args.output_dir / item["file"]).stat().st_size for item in references)
    print(f"References written: {len(references)}")
    print(f"Binary size: {total_bytes / (1024 * 1024):.2f} MB")
    print(f"Hello hash matches existing asset: {hello_hash_matches}")


if __name__ == "__main__":
    main()
