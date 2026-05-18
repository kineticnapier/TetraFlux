# Fix logging.ts chunk upload escaping

## 原因

前回の `src/logging.ts` 生成時に、TypeScript内の `\n` や `/\r?\n/` が実改行として壊れていました。

壊れていた例:

```ts
jsonl.split(/
?
/)
```

正しくは:

```ts
jsonl.split(/\r?\n/)
```

## 修正内容

`src/logging.ts` のchunk upload部分を修正しました。

```ts
const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
const lineWithNewline = `${line}\n`;
chunks.push(current.join("\n") + "\n");
```

## 変更ファイル

```text
src/logging.ts
README_FIX_LOGGING_CHUNK_ESCAPE.md
```

## 反映

```powershell
git add src/logging.ts README_FIX_LOGGING_CHUNK_ESCAPE.md
git commit -m "Fix chunk upload newline escaping"
git push
```
