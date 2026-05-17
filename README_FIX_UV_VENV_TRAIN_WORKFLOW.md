# Fix uv virtual environment error

## Error

```text
uv pip install --python 3.11 -r requirements-training.txt
error: No virtual environment found for Python 3.11
```

## Fix

GitHub Actions内で明示的にvenvを作ってから、そこへinstallします。

```bash
uv python install 3.11
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-training.txt
```

以降のPython scriptは全部:

```bash
.venv/bin/python tools/...
```

で実行します。

## Changed file

```text
.github/workflows/train-from-r2.yml
```
