# 领域内容图解：内镜成像模式

- 文件：`endoscopy-modes.png`
- 生成日期：2026-09-12
- 用途：网页中成对展示白光内镜与联动成像模式的抽象配色示意。标签、研究结果与来源均由 HTML 提供。
- 图像边界：AI 生成的教材风格插画，不是患者影像，不用于诊断，不表示任何病灶、效能差异或数据。两屏展示对应的抽象黏膜褶皱；颜色仅帮助区分成像模式。
- 风格参考：`design-explorations/2026-09-12-domain-brief/revision-2/01-content-understanding.png` 的第三栏双屏插画。未裁切或直接复用该参考中的图像。
- 工具：内置 `image_gen`，共 2 次调用（一次生成、一次风格修正）；费用未知。
- 最终尺寸：1774 × 887，2:1，白色背景 PNG，完整双屏单一资产。
- 最终原始文件：`/Users/lsel/.codex/generated_images/01a095e2-9b9c-7e00-b3cd-fab5d297e225/exec-cdace587-7aa6-4da6-aa1d-8afb725f9be2.png`
- 首稿原始文件：`/Users/lsel/.codex/generated_images/01a095e2-9b9c-7e00-b3cd-fab5d297e225/exec-b0416a5d-caea-4aa9-bf2f-a7ca74bdb0dc.png`
- 人工图像检查：两屏完整、颜色对应、无文字/数字/箭头/病灶标注；终稿已将偏写实的首稿改为明显插画风格。

## 初次生成提示词

```text
Use case: scientific-educational.
Asset type: a polished raster illustration asset embedded inside a Chinese medical research web application, not a UI screenshot.
Primary request: Create one complete horizontal illustration showing two small medical endoscopy display monitors side by side, equal size, in a roughly 2:1 overall landscape canvas. The whole pair is one asset.
Scene/backdrop: clean pure white background, minimal outer padding, no room or setting.
Subject: each monitor shows the exact same abstract gastric mucosa folds and vascular topology; the left display uses warm pale salmon and coral colors suggesting conventional white-light imaging, the right uses rose-pink and lilac colors suggesting linked-color imaging. Do not suggest a diagnosed lesion or comparative efficacy. No target circle or markings.
Style/medium: refined flat medical-textbook illustration, clean fine dark forest-green outlines, soft restrained shading, elegant muted botanical greens for monitor frame and pedestal, soft organic pink-purple mucosa. Attractive and detailed enough for a professional research workbench, not childish clip art, not photorealistic.
Composition/framing: two equally sized upright rectangular monitor screens, front view, small matching stands, aligned baseline, modest narrow white gap between them; each monitor fills almost half the composition. Whole monitors fully in frame. Focus is the illustrated mucosa in the screens.
Constraints: no words, letters, numbers, captions, labels, arrows, logos, watermarks, circle callouts, scale bars, data, patient photographs, diagnostic claims, or extra objects. Do not draw a full browser or page. Do not use any source screenshot as a background. Entire output is only the two cleanly illustrated monitors on white.
```

## 风格修正提示词

```text
Edit the provided generated illustration only. Keep its exact composition: two equally sized green medical monitors side by side, same abstract mucosa folds and corresponding topology on both displays, warm coral left and pink-purple right, clean white background, landscape 2:1. Change only the rendering style: flatten the screen contents into a clearly hand-drawn medical textbook diagram with simplified organic contour shapes, fine muted outlines, 4 to 6 discrete pastel color tones, soft minimal flat fills. Greatly reduce tiny vessels and texture. Remove realistic wet gloss, specular highlights, photographic detail and 3D rendering from the screen contents. Keep enough broad abstract mucosal folds to suggest endoscopic imaging, but unmistakably illustrative, not clinical imagery. Simplify the monitor frames and stands into fine dark forest-green outline drawings with pale sage fill and almost no 3D shading, resembling an elegant editorial science illustration. No words, letters, numbers, arrows, lesion targets, captions, logos, watermarks, data or extra objects.
```
