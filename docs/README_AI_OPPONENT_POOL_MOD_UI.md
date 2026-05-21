# Add AI opponent pool mode and move mod UI

## 変更内容

### 1. AI Opponent Pool modeを追加

Mode切り替えは次の順番になります。

```text
Human vs AI
AI Battle
AI Opponent Pool
Zenith Tower
```

### 2. AI Battleは従来通り自分対自分

```text
AI Battle:
  loaded AI vs loaded AI
```

つまりHybridが読み込まれていれば:

```text
HybridAI vs HybridAI
```

### 3. AI Opponent Poolは相手を毎roundランダム選択

```text
AI Opponent Pool:
  loaded AI vs random opponent
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

`battleOpponentKind` をStatusに表示します。

### 4. mod選択は2つの盤面の間に移動

`toolbar` ではなく、canvas上の2盤面の間あたりに固定表示します。

表示対象:

```text
AI Battle
AI Opponent Pool
```

Human vs AI / Zenith Towerでは非表示です。

### 5. No Holdの見せ方を変更

mod欄は赤くしません。  
代わりに各盤面の `HOLD` 欄を赤枠にし、`NO HOLD` と表示します。

## 変更ファイル

```text
src/main.ts
src/render.ts
README_AI_OPPONENT_POOL_MOD_UI.md
```

## 反映

```powershell
git add src/main.ts src/render.ts README_AI_OPPONENT_POOL_MOD_UI.md
git commit -m "Add AI opponent pool mode and move mod UI"
git push
```
