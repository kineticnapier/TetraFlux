# Fix Zenith Tower attack cancel

## 原因

Zenith Towerでは、bot pressureで来たgarbageを `human.pendingGarbage` に積んでいましたが、プレイヤーの攻撃はbotへ送るだけで、自分のpending garbageを相殺していませんでした。

旧処理:

```text
player clear
↓
result.attackSent
↓
zenith.applyPlayerAttack(result.attackSent)
↓
botへ攻撃
↓
自分のpendingGarbageは減らない
```

そのため、攻撃してもキャンセルできませんでした。

## 修正内容

Zenith modeのlock処理で、攻撃を次の順に使います。

```text
1. human.pendingGarbage をキャンセル
2. まだ整数ライン化していない zenithIncomingCarry をキャンセル
3. 余った攻撃だけbotへ送る
```

新処理:

```text
result.attackSent
↓
resolveZenithAttackCancel()
↓
sentToBots / canceled に分離
↓
canceled はUIに表示
↓
sentToBots だけbotへ攻撃
```

## UI

Zenith panelとStatusに `cancel` を表示します。

```text
sent: 12  cancel: 8
```

## 変更ファイル

```text
src/main.ts
README_FIX_ZENITH_ATTACK_CANCEL.md
```

## 反映

```powershell
git add src/main.ts README_FIX_ZENITH_ATTACK_CANCEL.md
git commit -m "Fix Zenith attack cancel"
git push
```
