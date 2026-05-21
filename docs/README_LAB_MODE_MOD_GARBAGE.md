# Lab mode and modded garbage

## 変更内容

### 1. Mirror Hybridをopponent poolから削除

AI Battleの相手候補から `Mirror Hybrid` を削除しました。

残る候補:

```text
Heuristic
Aggressive
Defensive
Downstacker
Combo
Spin
Noisy Hybrid
```

### 2. mod選択を下へ移動

mod selectの表示位置を下げました。

```ts
rect.top + 82
↓
rect.top + 132
```

### 3. 実験場 modeを追加

Mode切り替えに `実験場` を追加しました。

```text
Human vs AI
AI Battle
実験場
Zenith Tower
```

実験場はAIが1人でgarbage処理するモードです。

```text
AI solo
↓
1 bag = 7 pieces locked
↓
指定量のgarbageをqueue
↓
AIが処理し続ける
```

### 4. garbage量は可変

Settingsに次の項目を追加しました。

```text
Lab garbage/bag
```

デフォルトは `4` です。  
範囲は `0〜30` に制限しています。

### 5. 実験場のgarbageはmodの影響を受ける

実験場でもmod selectを表示し、garbage生成にmodを適用します。

例:

```text
Messier Garbage:
  穴が散らばりやすくなる

Double Hole Garbage:
  2穴garbageが出ることがある

Volatile Garbage:
  受けるgarbage量が増える

Expert Mode:
  instant entry garbageとして即投入
```

### 6. topoutしても継続

実験場ではtopoutしてもmatch終了にせず、boardをリセットして続行します。

## 変更ファイル

```text
src/main.ts
README_LAB_MODE_MOD_GARBAGE.md
```

## 反映

```powershell
git add src/main.ts README_LAB_MODE_MOD_GARBAGE.md
git commit -m "Add lab mode with modded garbage"
git push
```
