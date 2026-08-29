"""
config.py
=========
Master Project Root Configuration Bridge.
Imports and exposes PROJECT_CONFIG from src/config/project_config.py
"""

from src.config.project_config import (
    PROJECT_CONFIG,
    ProjectMasterConfig,
    SystemConfig,
    CapitalAndRiskConfig,
    GateConfig,
    UniverseConfig,
    ProfitSweeperConfig,
)

__all__ = [
    "PROJECT_CONFIG",
    "ProjectMasterConfig",
    "SystemConfig",
    "CapitalAndRiskConfig",
    "GateConfig",
    "UniverseConfig",
    "ProfitSweeperConfig",
]
