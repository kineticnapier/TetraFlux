# Merge opponent pool into AI Battle

## 変更内容

### 1. AI Opponent Pool modeを廃止

別モードとして追加していた `AI Opponent Pool` を削除しました。

Mode切り替えは次の3つだけです。

```text
Human vs AI
AI Battle
Zenith Tower
```

### 2. Opponent Pool機能をAI Battleに統合

AI Battle開始時、右側の相手をopponent poolからランダム選択します。

```text
left:
  loaded AI

right:
  random opponent
```

相手候補:

```text
Mirror Hybrid
Heuristic
Aggressive
Defensive
Downstacker
Combo
Spin
Noisy Hybrid
```

### 3. AI BattleもRキー開始に変更

AI Battleに切り替えた直後は自動開始しません。

```text
AI Battle mode
↓
WAITING: press R
↓
Rで開始
```

FT15終了後にログuploadされたあとも、次のmatchはRで開始します。

### 4. mod選択を少し上に移動

2つの盤面の間に置いていたmod selectが被っていたので、表示位置を50px上げました。

### 5. No Hold表示

mod欄は赤くしません。  
No Hold中は各盤面のHOLD欄側が赤枠になります。

## 変更ファイル

```text
src/main.ts
README_MERGE_OPPONENT_POOL_INTO_AI_BATTLE.md
```

## 反映

```powershell
git add src/main.ts README_MERGE_OPPONENT_POOL_INTO_AI_BATTLE.md
git commit -m "Merge opponent pool into AI Battle"
git push
```
