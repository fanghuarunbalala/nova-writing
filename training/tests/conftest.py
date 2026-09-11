"""pytest 公共夹具：仓库根路径与书库夹具定位。"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
YWJS_BOOK = REPO_ROOT / "evals" / "fixtures" / "books" / "ywjs" / "book.json"


@pytest.fixture(scope="session")
def repo_root() -> Path:
	return REPO_ROOT


def pytest_configure(config: pytest.Config) -> None:
	if not YWJS_BOOK.exists():
		config.addinivalue_line("markers", "needs_fixture: 依赖书库夹具（缺夹具时跳过）")
