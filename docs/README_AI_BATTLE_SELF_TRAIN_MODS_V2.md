# AI Battle self-training and revised Quick Play mods

## 変更内容

### 1. Self Training画面を廃止

`self_train` modeを削除しました。

Mode切り替えは次の3つだけです。

```text
Human vs AI
AI Battle
Zenith Tower
```

### 2. AI Battleを自己トレーニング化

AI Battleは、読み込まれたAI同士の対戦になりました。

```text
HybridAI vs HybridAI
```

`setLoadedAi()` で左右のAIを両方とも読み込まれたAIにしています。

FT15終了後はselfplayログをuploadし、約0.85秒後に自動で次のFT15を開始します。  
止めたい場合はModeを切り替えてください。

### 3. mod選択はAI Battle画面のみ

mod selectはAI Battle中だけ表示します。  
Human vs AI / Zenith Towerでは非表示です。

No Holdのときはselectを赤系にして分かりやすくしました。

### 4. All-Spin罰則を変更

旧:

```text
同じaction連続で +4 garbage
```

新:

```text
7回ライン消し
↓
breakable garbageを下に1段追加
↓
次にライン消しした後、通常の穴持ちgarbageへ変化
```

実装内容:

```text
src/main.ts:
  allSpinClearStreak
  allSpinBreakRows
  applyAllSpinBreakGarbage()

src/engine/tetris.ts:
  Cellに "B" を追加
  addBrokenGarbageRows()
  convertBrokenGarbageToNormal()
```

`B` rowは穴付きのbreakable garbageとして追加されます。  
ライン消しが発生した後、`B` は通常の `G` に変わります。

### 5. Invisibleでbreakable garbageも見える

Invisible中も `G` と `B` は常に表示します。

## 変更ファイル

```text
src/main.ts
src/engine/tetris.ts
src/render.ts
README_AI_BATTLE_SELF_TRAIN_MODS_V2.md
```

## 反映

```powershell
git add src/main.ts src/engine/tetris.ts src/render.ts README_AI_BATTLE_SELF_TRAIN_MODS_V2.md
git commit -m "Make AI Battle self-training and revise All-Spin penalty"
git push
```
