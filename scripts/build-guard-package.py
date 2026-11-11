#!/usr/bin/python3
"""Synchronize the dependency-free npm CLI's engine from the canonical source."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parent.parent
source = root / 'scripts/reposhield_guard.py'
target = root / 'cli/lib/reposhield_guard.py'
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, target)
print('CLI engine synchronized. Package with npm pack --ignore-scripts ./cli.')
