"""
model_loader.py — loads XGBoost artifacts produced by train.py.

The service uses two file conventions:
    models/<crop>__<state>.json     # XGBoost native format
    models/metadata.json            # features, metrics, trained_at

Models are loaded once at process start and cached. The loader is
threadsafe-ish: xgboost.Booster objects are immutable after load so
multiple concurrent predict() calls are fine.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Dict, Optional, Tuple

import xgboost as xgb


class ModelRegistry:
    def __init__(self, models_dir: str) -> None:
        self.models_dir = models_dir
        self._lock = threading.Lock()
        self._models: Dict[str, xgb.XGBRegressor] = {}
        self._meta: Optional[dict] = None
        self._feature_names = None
        self._disclaimer = None

    def load(self) -> "ModelRegistry":
        with self._lock:
            self._models = {}
            self._meta = None
            if not os.path.isdir(self.models_dir):
                return self
            meta_path = os.path.join(self.models_dir, "metadata.json")
            if os.path.exists(meta_path):
                with open(meta_path, "r", encoding="utf-8") as fh:
                    self._meta = json.load(fh)
                self._feature_names = self._meta.get("feature_names")
                self._disclaimer = self._meta.get("disclaimer")
            for fname in os.listdir(self.models_dir):
                if not fname.endswith(".json") or fname == "metadata.json":
                    continue
                key = fname[:-5]  # strip ".json"
                booster = xgb.XGBRegressor()
                booster.load_model(os.path.join(self.models_dir, fname))
                self._models[key] = booster
        return self

    def reload(self) -> "ModelRegistry":
        return self.load()

    @property
    def feature_names(self):
        return self._feature_names

    @property
    def disclaimer(self) -> str:
        return (
            self._disclaimer
            or "Heuristic forecast. NOT financial advice. Compare to a real "
            "model before acting."
        )

    @property
    def n_models(self) -> int:
        return len(self._models)

    def has(self, crop: str, state: Optional[str]) -> bool:
        if state is None:
            # If no state is given, look for any model for this crop
            # across all states. The caller decides which state's
            # history to use as input.
            return any(self._key_matches_crop(k, crop) for k in self._models)
        return self._key(crop, state) in self._models

    def _key(self, crop: str, state: str) -> str:
        def slug(s: str) -> str:
            return "".join(c if c.isalnum() else "_" for c in s).strip("_").lower()
        return f"{slug(crop)}__{slug(state)}"

    def _key_matches_crop(self, key: str, crop: str) -> bool:
        # The key format is "<crop>__<state>". Split on the first
        # double-underscore to recover the crop slug. If the crop
        # string contains " " (e.g. "Green Chilli") the slug will
        # use underscores, so the exact-match check is what we want.
        def slug(s: str) -> str:
            return "".join(c if c.isalnum() else "_" for c in s).strip("_").lower()
        crop_slug = slug(crop)
        head = key.split("__", 1)[0]
        return head == crop_slug

    def pick(self, crop: str, state: Optional[str]) -> Tuple[Optional[str], Optional[xgb.XGBRegressor]]:
        if state:
            k = self._key(crop, state)
            if k in self._models:
                return k, self._models[k]
        # Fall back: any model for this crop. Prefer the one with
        # the largest key (deterministic; not a real tie-breaker
        # beyond reproducibility).
        for k in sorted(self._models.keys()):
            if self._key_matches_crop(k, crop):
                return k, self._models[k]
        return None, None

    def metadata(self) -> Optional[dict]:
        return self._meta
