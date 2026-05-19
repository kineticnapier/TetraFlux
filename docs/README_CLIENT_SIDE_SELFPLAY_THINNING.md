# Client-side selfplay thinning before upload

## できること

できます。  
今回の変更では、AI Battleのselfplayログを **R2へ送る前にクライアント側で間引き** します。

今まで:

```text
AI Battle FT15
↓
全selfplay rowsを保持
↓
toJsonl()
↓
19848 rows upload
↓
R2側/学習側でfilter
```

修正後:

```text
AI Battle FT15
↓
全selfplay rowsを保持
↓
client-side thinning
↓
最大3000 rows程度だけupload
↓
R2へ保存
```

## 間引き方

学習時にやっているfilterに近い考え方で、送る前に以下を残します。

```text
必ず残す:
  topout
  round end / match end
  terminal rewardあり
  attack_sent > 0
  raw_attack > 0
  2ライン以上消した手
  spin clear
  各round末尾16手

定期サンプル:
  12手に1回
  ただし盤面が極端に汚すぎないもの
```

soft filter:

```text
holes <= 32
maxHeight <= 19
pendingGarbage <= 16
```

最終的に多すぎる場合:

```text
SELFPLAY_UPLOAD_MAX_ROWS = 3000
```

でcapします。

## 注意

`toJsonl()` はアップロード用に間引いたJSONLを返します。  
完全なログが必要な場合用に:

```ts
fullJsonl()
```

も追加しています。

## 変更ファイル

```text
src/logging.ts
README_CLIENT_SIDE_SELFPLAY_THINNING.md
```

## 反映

```powershell
git add src/logging.ts README_CLIENT_SIDE_SELFPLAY_THINNING.md
git commit -m "Thin selfplay logs on client before upload"
git push
```
