# Special mod exclusivity, Last Stand indicator, Damnation attack fix

## 変更内容

### 1. DamnationのBLIGHTED mechanicを廃止

Damnationで通常clearが攻撃/相殺できない処理を削除しました。

```text
旧:
  BLIGHTED以外は攻撃/相殺しない

新:
  通常通り攻撃/相殺する
```

残るDamnation効果:

```text
開始盤面 checkerboard
All-Spin無効
ゴミ穴6〜7個
```

### 2. Last Standのhole indicator追加

Last Stand中、盤面上に「ここに穴が来る」印を表示します。

```text
H = current hole indicator
N = next indicator
```

約80ライン分のincomingを受けると、indicatorが次の場所へ移動します。

### 3. Specialと通常Modを併用不可に変更

通常Modを選んだ場合:

```text
Special -> No Special
```

Specialを選んだ場合:

```text
Mod -> No Mod
```

内部的にも、通常Modが有効ならSpecial効果は無効化される安全策を入れています。

## build

`npm run build` で確認済みです。

## 変更ファイル

```text
src/main.ts
src/render.ts
README_SPECIAL_MOD_EXCLUSIVE_LASTSTAND_DAMNATION.md
```
