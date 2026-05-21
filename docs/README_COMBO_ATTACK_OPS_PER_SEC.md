# Combo attack and AI ops/sec setting

## 変更内容

### 1. 1列消しでもcomboで攻撃が出るように変更

旧仕様では通常Single/Double/Tripleに厳しいcapがありました。

```ts
cap = lines - 1
```

そのためSingleはcomboが乗っても最大0 attackでした。

新仕様:

```ts
cap = lines + floor(combo / 2)
```

これにより、1列消しでもcomboが重なると攻撃できます。

### 2. AI速度設定をPPSから操作量/秒に変更

旧:

```text
AI PPS:
  1秒あたりの配置数
```

新:

```text
AI ops/s:
  1秒あたりの操作数
```

1操作として数えるもの:

```text
left
right
cw
ccw
180
hold
harddrop
```

AIが遠い場所へ置く場合:

```text
left,left,cw,harddrop
```

なら4 opsを消費します。

### 3. 既存設定の自動移行

旧 `aiPps` がlocalStorageにある場合は:

```ts
aiOpsPerSecond = aiPps * 7
```

として読み替えます。

## 変更ファイル

```text
src/main.ts
src/engine/tetris.ts
README_COMBO_ATTACK_OPS_PER_SEC.md
```

## 反映

```powershell
git add src/main.ts src/engine/tetris.ts README_COMBO_ATTACK_OPS_PER_SEC.md
git commit -m "Use AI ops per second and allow combo singles to attack"
git push
```
