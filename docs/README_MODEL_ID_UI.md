# Model ID / UI offset update

## 変更点

```text
tools/export_web_policy_json.py:
  JSONに model_id / exported_at / checkpoint_name / sha を埋め込む

src/ai/webPolicy.ts:
  model_idなどを読み取れるようにする
  displayName() / infoLines() を追加

src/main.ts:
  Statusに読み込んだモデルのID・export時刻・checkpoint名を表示
  盤面パネル全体を下へ移動
  GitHub Pagesのbase pathを考慮して model URL を読む
```

## export例

```powershell
python .\tools\export_web_policy_json.py `
  --checkpoint .\models\web_human_policy_clean\best_policy.pt `
  --out .\public\models\web_policy.json `
  --model-name clean_v4
```

`--model-name` は任意です。
指定しない場合はcheckpointの親フォルダ名が使われます。

## Web側の表示例

```text
WebPolicyAI clean_v4_20260517_...
id: clean_v4_20260517_...
export: 2026-05-17T...
ckpt: best_policy.pt
sha: xxxxxxxxxxxx
```
