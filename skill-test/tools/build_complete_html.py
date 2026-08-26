import json
from pathlib import Path

slug = "ml-nhap-mon-toan-dien-5p"
root = Path(__file__).resolve().parent.parent
job_dir = root / "jobs" / slug
hf_dir = root / "starter-hf" / slug

beats_path = job_dir / "beats.json"
beats_data = json.loads(beats_path.read_text(encoding="utf-8"))
total_duration = beats_data["totalSeconds"]
beats = beats_data["beats"]

captions_snippet_path = hf_dir / "captions_snippet.html"
captions_snippet = captions_snippet_path.read_text(encoding="utf-8")

audio_and_captions_html = captions_snippet.split("<!-- ===== PASTE vao cuoi <script>")[0].replace("<!-- ===== PASTE vao trong #root, cuoi file ===== -->", "").strip()
caption_script_js = captions_snippet.split("<!-- ===== PASTE vao cuoi <script>, truoc khi dang ky timeline ===== -->")[1].strip() if "<!-- ===== PASTE vao cuoi <script>, truoc khi dang ky timeline ===== -->" in captions_snippet else ""

inline_fonts_css = """
@font-face { font-family:'Be Vietnam Pro'; font-style:normal; font-weight:400; src:url('fonts/BeVietnamPro-400-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }
@font-face { font-family:'Be Vietnam Pro'; font-style:normal; font-weight:400; src:url('fonts/BeVietnamPro-400-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }
@font-face { font-family:'Be Vietnam Pro'; font-style:normal; font-weight:600; src:url('fonts/BeVietnamPro-600-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }
@font-face { font-family:'Be Vietnam Pro'; font-style:normal; font-weight:600; src:url('fonts/BeVietnamPro-600-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }
@font-face { font-family:'Be Vietnam Pro'; font-style:normal; font-weight:900; src:url('fonts/BeVietnamPro-900-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }
@font-face { font-family:'Be Vietnam Pro'; font-style:normal; font-weight:900; src:url('fonts/BeVietnamPro-900-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }

@font-face { font-family:'IBM Plex Mono'; font-style:normal; font-weight:400; src:url('fonts/IBMPlexMono-400-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }
@font-face { font-family:'IBM Plex Mono'; font-style:normal; font-weight:400; src:url('fonts/IBMPlexMono-400-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }
@font-face { font-family:'IBM Plex Mono'; font-style:normal; font-weight:600; src:url('fonts/IBMPlexMono-600-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }
@font-face { font-family:'IBM Plex Mono'; font-style:normal; font-weight:600; src:url('fonts/IBMPlexMono-600-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }
"""

css_styles = """
:root {
  --bg: #0B0E14;
  --ink: #F4F7FB;
  --ink-sub: #8B94A6;
  --accent: #60A5FA;
  --accent-sky: #38BDF8;
  --accent-green: #34D399;
  --accent-amber: #F59E0B;
  --accent-danger: #EF4444;
  --accent-purple: #A855F7;
  --panel: #121722;
  --panel-light: #1E293B;
  --border: rgba(96, 165, 250, 0.25);
  --caption-active: #60A5FA;
  --caption-idle: rgba(244, 247, 251, 0.45);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background-color: var(--bg);
  color: var(--ink);
  font-family: 'Be Vietnam Pro', sans-serif;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}

#root {
  position: relative;
  width: 1080px;
  height: 1920px;
  background-color: var(--bg);
  overflow: hidden;
}

.clip {
  position: absolute;
  inset: 0;
  width: 1080px;
  height: 1920px;
}

.scene-inner {
  position: absolute;
  inset: 0;
  width: 1080px;
  height: 1920px;
}

.eyebrow {
  position: absolute;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 36px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 4px;
  color: var(--accent);
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-display {
  position: absolute;
  font-family: 'Be Vietnam Pro', sans-serif;
  font-size: 64px;
  font-weight: 900;
  line-height: 1.15;
  color: var(--ink);
  max-width: 920px;
}

.card-hero {
  position: absolute;
  left: 80px;
  right: 80px;
}

.diagram-box {
  position: absolute;
  left: 80px;
  right: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.svg-canvas {
  width: 100%;
  height: 100%;
}

.svg-text-bold {
  font-family: 'Be Vietnam Pro', sans-serif;
  font-weight: 900;
  text-anchor: middle;
  dominant-baseline: middle;
}

.svg-text-mono {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: middle;
}

.svg-text-small {
  font-family: 'Be Vietnam Pro', sans-serif;
  font-weight: 600;
  font-size: 20px;
  text-anchor: middle;
  dominant-baseline: middle;
}

.stat-pill {
  position: absolute;
  background: var(--panel);
  border: 2px solid var(--border);
  border-radius: 20px;
  padding: 24px 32px;
  text-align: center;
  font-family: 'Be Vietnam Pro', sans-serif;
  font-size: 32px;
  font-weight: 700;
}

.mono-accent {
  font-family: 'IBM Plex Mono', monospace;
  color: var(--accent);
  font-weight: 600;
}

.text-sub {
  color: var(--ink-sub);
}

.stamp-badge {
  position: absolute;
  left: 120px;
  right: 120px;
  padding: 24px;
  text-align: center;
  border: 4px double var(--accent);
  color: var(--accent);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 34px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 3px;
  border-radius: 16px;
  background: rgba(96, 165, 250, 0.08);
}

.bg-accent {
  background: var(--accent);
  color: var(--bg);
  border: none;
  font-weight: 900;
}

.quote-card {
  position: absolute;
  background: var(--panel);
  border: 3px solid var(--border);
  border-radius: 28px;
  padding: 48px 40px;
}

.quote-tag {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 30px;
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 2px;
  margin-bottom: 24px;
}

.quote-text {
  font-size: 46px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ink);
  margin-bottom: 28px;
}

.quote-author {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 26px;
  color: var(--ink-sub);
}

.pulse-dot {
  width: 14px;
  height: 14px;
  background: var(--accent);
  border-radius: 50%;
  display: inline-block;
}

.caption-line {
  position: absolute;
  left: 60px;
  right: 60px;
  bottom: 280px;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  z-index: 10;
}

.cw {
  font-size: 54px;
  font-weight: 700;
  color: var(--caption-idle);
  transition: color 0.1s;
}
"""
