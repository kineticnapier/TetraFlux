# Default multi keybinds

## 変更内容

デフォルト操作を指定どおりに変更しました。

```text
Left        : Left
Right       : Right
Soft drop   : Down
Hard drop   : Space
CCW         : Ctrl, Z
CW          : Up, X
180         : A
Hold        : Shift, C
```

## 複数キー対応

`KeyBindings` を `string` から `string[]` に変更しました。

例:

```ts
rotateCcw: ["Control", "z"]
rotateCw: ["ArrowUp", "x"]
hold: ["Shift", "c"]
```

Settings popupでは:

```text
Ctrl, Z
Up, X
Shift, C
```

のようにカンマ区切りで編集できます。

## localStorage

既存ユーザーの古い設定と衝突しないように、設定キーを変更しました。

```text
old: tetraflux_settings_v1
new: tetraflux_settings_v2_multikey
```

そのため、初回ロード時に新しいデフォルトが反映されます。
