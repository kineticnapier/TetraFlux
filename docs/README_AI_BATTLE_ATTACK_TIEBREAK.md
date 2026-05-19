# AI Battle attack-sent tiebreak

## 方針

AI Battleのround上限に達したときは、盤面の綺麗さより先に:

```text
実際に相手へ送った攻撃量
```

が多い方を勝ちにします。

これは、盤面だけで判定すると「ひたすら守るAI」が有利になりやすいからです。

## 判定順

round上限到達時:

```text
1. 実際に相手へ送った攻撃量 sent が多い方
2. sentが同じなら盤面dangerが低い方
3. dangerも同じならpending garbageが少ない方
4. それも同じならround indexで deterministic tie-break
```

## raw / sent / canceled

`applyAttack()` を返り値ありに変更しました。

```text
rawAttack:
  clear / spin / combo で発生した攻撃

canceled:
  自分に来ていたgarbageと相殺した量

sent:
  実際に相手へ送った量
```

勝敗に使うのは `sent` です。

## UI

AI BattleのStatusに追加:

```text
sent: 120 - 98
raw/cancel: 160/40 - 130/32
```

## 変更ファイル

```text
src/main.ts
README_AI_BATTLE_ATTACK_TIEBREAK.md
```

## 反映

```powershell
git add src/main.ts README_AI_BATTLE_ATTACK_TIEBREAK.md
git commit -m "Use sent attack as AI battle tiebreak"
git push
```