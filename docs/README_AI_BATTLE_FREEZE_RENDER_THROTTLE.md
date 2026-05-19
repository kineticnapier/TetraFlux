# Fix AI Battle late-round freeze and high-PPS rendering

## 変更内容

### 1. AI Battleのround 14/15付近フリーズ対策

原因候補として一番大きいのは、AI Battleのselfplay JSONLが大きくなり、`localStorage` 保存が終盤でquota超過して例外を投げることです。

そのため、`SelfplayLogger.finishRound()` では巨大なJSONLをlocalStorageに保存しないようにしました。

```ts
// Do not persist full selfplay logs to localStorage.
```

ログ本体はメモリ上には残るので、FT15終了時のselfplay uploadやDownload Logsは使えます。

また、AI Battleの自動次roundを `performance.now()` 判定だけでなく、`setTimeout()` でも進むようにしました。

```text
round end
↓
setTimeout(700ms)
↓
nextRound()
```

### 2. PPS 15超えの描画負荷対策

AI Battle中で `AI mino/s > 15` の場合、毎フレームcanvas全体を描画せず、数手ごとに描画するようにしました。

```text
PPS <= 15:
  毎frame描画

PPS > 15:
  4〜6手ごと、または約220msごとに描画
```

AIの内部進行は止めず、画面更新だけ間引きます。

## 変更ファイル

```text
src/logging.ts
src/main.ts
README_AI_BATTLE_FREEZE_RENDER_THROTTLE.md
```

## 反映

```powershell
git add src/logging.ts src/main.ts README_AI_BATTLE_FREEZE_RENDER_THROTTLE.md
git commit -m "Fix AI battle late-round freeze and throttle high PPS rendering"
git push
```
