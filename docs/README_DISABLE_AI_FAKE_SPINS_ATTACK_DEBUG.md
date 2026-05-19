# Disable AI fake spins and add attack debug

## 原因

Heuristicが異常に強い攻撃を出していた主因は、AIの `applyAction()` が最終配置を直接置くのに、内部では「回転して入れた」としてspin判定していたことです。

```text
AI action:
  piece:x:rot を直接指定
↓
lastActionWasRotation = true
↓
最終位置が left/right/down に動けない
↓
generic spin 扱い
↓
普通の置き方でも spin double/triple になって攻撃が増える
```

つまり、Heuristicが実際には不可能な「fake spin」を大量に拾っていました。

## 修正内容

### 1. AI direct placementではspinを無効化

Humanの実操作:

```text
rotateCw / rotateCcw / rotate180
↓
lock
↓
spin判定あり
```

AIのdirect placement:

```text
applyAction(piece:x:rot)
↓
hardDrop
↓
spin判定なし
```

にしました。

これでAIが「最終配置が動けないだけ」のfake spinを攻撃源にできなくなります。

### 2. 普通消し攻撃のcapを維持

```text
Single: 0
Double: 1
Triple: 2
Quad:   4
```

普通の1〜3ライン消しはcombo込みでも:

```text
攻撃 < 消したライン数
```

にcapしています。

### 3. 攻撃内訳を表示

盤面下のlast表示をこうしました。

```text
last: 3L none atk=2 base=2 b2b=0 cmb=0
```

異常値が出たら、どこで増えたか見えます。

```text
base:
  line clear / spin本体

b2b:
  back-to-back bonus

cmb:
  combo bonus

cap:
  普通消しcapが発動
```

## 変更ファイル

```text
src/engine/tetris.ts
src/render.ts
README_DISABLE_AI_FAKE_SPINS_ATTACK_DEBUG.md
```

## 反映

```powershell
git add src/engine/tetris.ts src/render.ts README_DISABLE_AI_FAKE_SPINS_ATTACK_DEBUG.md
git commit -m "Disable fake AI spins and show attack components"
git push
```
