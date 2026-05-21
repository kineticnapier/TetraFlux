# Garbage Lab gray/red warning and mobile support

## 変更内容

### 1. Garbage Labのwarning表示を灰色→赤に変更

Garbage Labのgarbageフローを次のようにしました。

```text
garbage scheduled
↓
gray incoming
↓
2.5s後にred ready
↓
次にミノをlockした瞬間、盤面に入る
```

表示項目:

```text
gray incoming: まだ時間経過前のgarbage
red ready: 放出待ちのgarbage
total warning: gray + red
entered board: 実際に盤面へ入ったgarbage
```

### 2. スマホ対応

以下を追加しました。

```text
・canvasを狭い画面では1280px基準で縮小描画
・mod select位置もcanvas scaleに追従
・toolbarを横スクロール化
・スマホ用touch controlsを追加
```

Touch controls:

```text
START / NEXT
left / soft drop / right / hard drop
CCW / CW / 180 / HOLD
```

### 3. build確認

この変更後、次を実行して通過確認済みです。

```bash
npm run build
```

結果:

```text
tsc && vite build passed
```

## 変更ファイル

```text
src/main.ts
src/style.css
README_LAB_GRAY_RED_MOBILE.md
```

## 反映

```powershell
git add src/main.ts src/style.css README_LAB_GRAY_RED_MOBILE.md
git commit -m "Add gray red lab garbage and mobile controls"
git push
```
