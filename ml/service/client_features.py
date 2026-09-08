"""
client_features.py — single source of truth for "what features does
the live prediction row carry". Imports the SAME module the training
script used (training.features) so the schema is bit-comparable.
"""
from __future__ import annotations

import os
import sys
from typing import Optional

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
_TRAINING = os.path.abspath(os.path.join(_HERE, "..", "training"))
if _TRAINING not in sys.path:
    sys.path.insert(0, _TRAINING)

import features as _F  # noqa: E402


def build_live_row(series: pd.DataFrame) -> Optional[list]:
    """Return the feature row representing "as of series' last known
    day". Returns None if there is not enough history.
    """
    if series.empty or len(series) < 2:
        return None
    try:
        return _F.same_features(series)
    except ValueError:
        return None
