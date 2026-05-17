# Fix CF Pages deploy heredoc error

## Error

```text
warning: here-document at line 2 delimited by end-of-file (wanted `PY')
syntax error: unexpected end of file
```

## Cause

The previous workflow used a bash heredoc inside an `if` block:

```bash
if [ -f dist/models/web_policy.json ]; then
  "$PY" - <<'PY'
  ...
  PY
fi
```

Bash heredoc end markers must be recognized exactly as the delimiter on their own line. Indenting or embedding them incorrectly inside generated shell scripts can break parsing. This is a common shell heredoc rule. See the here-document syntax description: the closing delimiter is the same identifier on its own line. 

## Fix

This update removes heredocs from workflows and adds:

```text
tools/inspect_web_policy_json.py
```

Workflows now call:

```bash
"$PY" tools/inspect_web_policy_json.py --file dist/models/web_policy.json --label "DEPLOY MODEL IN DIST" --allow-missing
```

## Changed files

```text
tools/inspect_web_policy_json.py
.github/workflows/deploy-cloudflare.yml
.github/workflows/train-from-r2.yml
README_FIX_HEREDOC_CF_DEPLOY.md
```
