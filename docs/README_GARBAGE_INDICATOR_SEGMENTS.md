# Garbage Lab indicator segments

## 変更内容

Garbage Labのwarning表示を右側パネルではなく、既存の左側 `G` garbage indicator に統合しました。

## 表示フロー

```text
garbage received
↓
G indicatorに gray scheduled として表示
↓
一定時間後 red ready に変化
↓
次にミノを置いた瞬間、盤面へ放出
```

## indicator表示

左の `G` meterに次を色付きで表示します。

```text
queued    : scheduled + ready の合計
scheduled : 灰色、まだ実体化前
ready     : 赤、次lockで放出
```

色:

```text
scheduled = #9ca3af
ready     = #ef4444
queued    = #fbbf24
```

右側のGarbage Lab panelからは、重複していた `scheduled / gray incoming / red ready / total warning` を削除し、左のG meterを見るようにしました。

## build確認

```bash
npm run build
```

通過済みです。

## 変更ファイル

```text
src/main.ts
src/render.ts
src/vite-env.d.ts
README_GARBAGE_INDICATOR_SEGMENTS.md
```
