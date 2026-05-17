# Web policy JSON export

`models/web_human_policy/best_policy.pt` が出たら、ブラウザ用JSONに変換します。

## 1. export

```powershell
python .\tools\export_web_policy_json.py `
  --checkpoint .\models\web_human_policy\best_policy.pt `
  --out .\public\models\web_policy.json
```

## 2. 起動

```powershell
npm run dev
```

起動後、右側Statusに:

```text
WebPolicyAI ... actions
Loaded /models/web_policy.json
```

と出れば成功です。

`public/models/web_policy.json` が無い場合は、自動で `HeuristicAI fallback` になります。

## 注意

このJSONはそこそこ大きくなります。GitHub Pagesなどに置く場合はサイズを確認してください。
