# Fix missing AttackCalc type

## 原因

`calcAttack()` の戻り値型に `AttackCalc` を指定していましたが、interface定義が抜けていました。

```ts
function calcAttack(...): AttackCalc
```

そのためTypeScriptで:

```text
Cannot find name 'AttackCalc'
```

が出てbuildが落ちていました。

## 修正内容

`src/engine/tetris.ts` に以下を追加しました。

```ts
interface AttackCalc {
  total: number;
  base: number;
  b2bBonus: number;
  comboBonus: number;
  capped: boolean;
}
```

## 変更ファイル

```text
src/engine/tetris.ts
README_FIX_ATTACKCALC_TYPE.md
```

## 反映

```powershell
git add src/engine/tetris.ts README_FIX_ATTACKCALC_TYPE.md
git commit -m "Fix missing AttackCalc type"
git push
```
