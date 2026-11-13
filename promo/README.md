# BranchMind 宣传片（9:16 竖屏）

一支约 38 秒的中文竖屏宣传片（1080×1920，30fps，H.264 MP4），中段直接使用首页的真实演示动画。

| 时间 | 镜头 |
|------|------|
| 0–4.5s | 痛点：线性聊天越刷越长，「对话太长，知识点梳理困难？」，随后虚化切入首页 |
| 4.5–22s | **首页真实演示录屏**：输入问题 → 向下延续 → 向右分支 → 第二组示例（读研还是工作），配字幕 |
| 22–26s | 01 思维地图：整棵树逐节点生长 |
| 26–30s | 02 PDF 精读：《Attention Is All You Need》原文高亮，回答附页码引用 |
| 30–33s | 03 知识上下文：挂载 PDF / 课程资料 |
| 33–38s | 收尾：「你可以外包思考，但是无法外包理解。」→ BranchMind 品牌卡 |

## 文件

- `capture-demo.mjs`：用 Playwright 的假时钟逐帧录制首页演示（`HomeOnboardingDemo`），每帧间隔严格相等，不受截图速度影响。输出到 `frames/demo/`。
- `composition.html`：整支片子的逐帧合成。每一帧都由 `renderFrame(t)` 根据时间算出来，不依赖 CSS 动画。直接用浏览器打开可以拖动进度条预览。
- `render.mjs`：逐帧截图 `composition.html`，通过管道交给 ffmpeg 编码，同时导出封面图。
- `out/`：成片 `branchmind-promo-9x16.mp4` 和封面 `branchmind-promo-cover.png`（已加入 gitignore）。

## 重新生成

```bash
# 1. 启动 mock 模式的开发服务器（不需要真实 AI / Supabase）
AI_MOCK_MODE=true BRANCHMIND_PROJECTS_BACKEND=file BRANCHMIND_RAG_BACKEND=file \
  NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= \
  npx next dev -H 127.0.0.1 -p 12760

# 2. 逐帧录制首页演示（约 1–2 分钟），之后服务器可以关掉
PROMO_BASE_URL=http://127.0.0.1:12760 node promo/capture-demo.mjs

# 3. 合成并编码（需要 ffmpeg：brew install ffmpeg）
node promo/render.mjs

# 只导出几张静帧检查画面
node promo/render.mjs --stills 3,7,12,28,40
```

改了首页演示的动画或文案后，重新跑第 2、3 步即可。演示时间轴变化时，同步调整
`composition.html` 里 Scene 3 的字幕时间（对应 `lib/home-onboarding-demo.ts` 的 `HOME_DEMO_TIMELINE`）。

## 背景音乐

成片默认无声，方便在抖音 / 小红书里直接选平台曲库的音乐。若要内嵌音乐，把音频放到
`promo/assets/bgm.mp3`（也支持 `.m4a` / `.wav`）后重新运行 `node promo/render.mjs`，
脚本会自动裁剪到片长并加淡入淡出。请确认音乐版权可商用。
