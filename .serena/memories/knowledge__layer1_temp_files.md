# Layer 1: Temp File Image Support (Archived)

## Status: REMOVED (preserved in `ref/layer1-temp-files` branch)

## What It Was
Layer 1 saved feedback images as temp files at `$TMPDIR/tasksync-images/<sessionId>/image-N.<ext>` and appended file paths to the text response: `[User attached N image(s): /path/...]`. Agents could then use file-reading tools to access images.

## Why It Was Removed
- Layer 2 (native image injection via `tool.execute.after` hook) proved reliable
- Layer 1 text paths became redundant noise in the LLM context
- Disk accumulation concern
- Simplified plugin code significantly

## Reference Branch
`ref/layer1-temp-files` — contains the full Layer 1 + Layer 2 implementation together.

## Key Code (for reference if ever needed again)
```typescript
// In connectAndWait(), on feedback with images:
const imageDir = join(tmpdir(), "tasksync-images", sessionId);
mkdirSync(imageDir, { recursive: true });
for (let i = 0; i < result.images.length; i++) {
  const ext = img.mimeType.split("/")[1] || "png";
  const filePath = join(imageDir, `image-${i}.${ext}`);
  writeFileSync(filePath, Buffer.from(img.data, "base64"));
}
// Returned: `${content}\n\n[User attached N image(s): paths...]`
```

## Imports Needed (if restoring)
```typescript
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
```
