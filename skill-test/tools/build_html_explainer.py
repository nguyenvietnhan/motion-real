import json
import html
from pathlib import Path

slug = "vi-sao-mat-khau-bi-ro-ri"
root = Path(__file__).resolve().parent.parent
job_dir = root / "jobs" / slug
hf_dir = root / "starter-hf" / slug

timing_path = job_dir / "timing.json"
timing_data = json.loads(timing_path.read_text(encoding="utf-8"))
total_sec = timing_data["total_duration"]
beats = timing_data["beats"]

# Collect all word timings
all_words = []
for b in beats:
    b_id = b["id"]
    meta_path = job_dir / "voice" / f"{b_id}.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        for w in meta.get("words", []):
            all_words.append({
                "word": w["word"],
                "start": round(b["start"] + w["start"], 3),
                "end": round(b["start"] + w["end"], 3)
            })

# Group words into 3-4 word chunks for readable short-form captions
caption_lines = []
for i in range(0, len(all_words), 4):
    chunk = all_words[i:i+4]
    c_start = chunk[0]["start"]
    c_end = chunk[-1]["end"]
    caption_lines.append({
        "words": chunk,
        "start": c_start,
        "end": c_end
    })

# Format caption HTML clips
caption_clips = []
for i, l in enumerate(caption_lines):
    is_last = (i == len(caption_lines) - 1)
    dur = round(l["end"] - l["start"] + (0.4 if is_last else 0.0), 2)
    spans = ' '.join([f'<span class="cw">{html.escape(w["word"])}</span>' for w in l["words"]])
    caption_clips.append(f'    <div id="cap-line-{i}" class="clip caption-line" data-start="{l["start"]:.2f}" data-duration="{dur:.2f}" data-track-index="8">{spans}</div>')

caption_clips_str = '\n'.join(caption_clips)

# Format CAPTION_WORDS data
caption_words_js = []
for li, l in enumerate(caption_lines):
    for wi, w in enumerate(l["words"]):
        caption_words_js.append([li, wi, w["start"], w["end"]])

caption_words_str = json.dumps(caption_words_js)

# Scene boundary definitions based on beats timing
# Scene 1: Intro (b1 + b2) -> start 0.00, end 10.50 (b3 start)
# Scene 2: Server Breaches & Stuffing (b3, b4, b5, b6) -> start 10.50, end 34.30 (b7 start)
# Scene 3: Infostealer & Cookie (b7, b8, b9, b10) -> start 34.30, end 59.54 (b11 start)
# Scene 4: Defense & Wrapup (b11, b12, b13, b14) -> start 59.54, end 84.61 (total_sec)

S1_START = 0.00
S1_DUR = round(beats[2]["start"] - S1_START, 2) # 10.50

S2_START = beats[2]["start"] # 10.50
S2_DUR = round(beats[6]["start"] - S2_START, 2) # 23.80

S3_START = beats[6]["start"] # 34.30
S3_DUR = round(beats[10]["start"] - S3_START, 2) # 25.24

S4_START = beats[10]["start"] # 59.54
S4_DUR = round(total_sec - S4_START, 2) # 25.07

html_content = f'''<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Vì sao mật khẩu bị rò rỉ dù không bấm link lạ?</title>
  <style>
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:400; src:url('fonts/BeVietnamPro-400-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:400; src:url('fonts/BeVietnamPro-400-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:600; src:url('fonts/BeVietnamPro-600-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:600; src:url('fonts/BeVietnamPro-600-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:900; src:url('fonts/BeVietnamPro-900-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:900; src:url('fonts/BeVietnamPro-900-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:400; src:url('fonts/IBMPlexMono-400-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:400; src:url('fonts/IBMPlexMono-400-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:600; src:url('fonts/IBMPlexMono-600-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:600; src:url('fonts/IBMPlexMono-600-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}

    :root {{
      --bg: #0B0E14;
      --ink: #F4F7FB;
      --ink-sub: #8B94A6;
      --accent: #38BDF8;
      --accent-blue: #60A5FA;
      --accent-emerald: #34D399;
      --accent-amber: #F59E0B;
      --accent-danger: #EF4444;
      --accent-purple: #A855F7;
      --panel: #121722;
      --panel-border: rgba(56, 189, 248, 0.22);
      --radius: 20px;
      --caption-active: #38BDF8;
      --caption-idle: rgba(244, 247, 251, 0.45);
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    body {{
      background: #000;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      font-family: 'Be Vietnam Pro', sans-serif;
      color: var(--ink);
    }}

    #root {{
      width: 1080px;
      height: 1920px;
      position: relative;
      overflow: hidden;
      background: var(--bg);
    }}

    .clip {{
      position: absolute;
      inset: 0;
    }}

    .scene-bg {{
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 50% 25%, #142033 0%, #0B0E14 75%);
      z-index: 1;
    }}

    .grid-overlay {{
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(to right, rgba(56, 189, 248, 0.04) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(56, 189, 248, 0.04) 1px, transparent 1px);
      background-size: 60px 60px;
      z-index: 2;
    }}

    .content-layer {{
      position: absolute;
      inset: 0;
      padding: 160px 72px 340px 72px;
      display: flex;
      flex-direction: column;
      z-index: 3;
    }}

    .scene-inner {{
      position: absolute;
      inset: 0;
      padding: 160px 72px 340px 72px;
      display: flex;
      flex-direction: column;
      z-index: 3;
    }}

    .sc-2, .sc-3, .sc-4 {{
      opacity: 0;
    }}

    .eyebrow {{
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 3px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
    }}

    .eyebrow::before {{
      content: '';
      display: inline-block;
      width: 14px;
      height: 14px;
      background: var(--accent);
      border-radius: 3px;
    }}

    .headline {{
      font-size: 60px;
      font-weight: 900;
      line-height: 1.18;
      color: var(--ink);
      margin-bottom: 32px;
    }}

    .headline span.hi {{
      color: var(--accent);
    }}

    .headline span.danger {{
      color: var(--accent-danger);
    }}

    .headline span.emerald {{
      color: var(--accent-emerald);
    }}

    .stamp {{
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 12px 28px;
      border: 6px double var(--accent);
      border-radius: 16px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      transform: rotate(-2deg);
      background: rgba(56, 189, 248, 0.1);
      width: fit-content;
    }}

    .stamp.danger {{
      border-color: var(--accent-danger);
      color: var(--accent-danger);
      background: rgba(239, 68, 68, 0.12);
    }}

    .stamp.emerald {{
      border-color: var(--accent-emerald);
      color: var(--accent-emerald);
      background: rgba(52, 211, 153, 0.12);
    }}

    .card {{
      background: var(--panel);
      border: 2px solid var(--panel-border);
      border-radius: var(--radius);
      padding: 28px;
      position: relative;
    }}

    .card-accent {{
      border-color: var(--accent);
      box-shadow: 0 12px 40px rgba(56, 189, 248, 0.15);
    }}

    .card-danger {{
      border-color: var(--accent-danger);
      box-shadow: 0 12px 40px rgba(239, 68, 68, 0.15);
    }}

    .mono-number {{
      font-family: 'IBM Plex Mono', monospace;
      font-size: 96px;
      font-weight: 700;
      color: var(--accent);
      line-height: 1;
    }}

    .mono-sub {{
      font-family: 'IBM Plex Mono', monospace;
      font-size: 28px;
      color: var(--ink-sub);
    }}

    .diagram-stage {{
      flex: 1;
      position: relative;
      background: var(--panel);
      border: 2px solid var(--panel-border);
      border-radius: var(--radius);
      padding: 32px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 840px;
    }}

    .svg-canvas {{
      width: 100%;
      height: 100%;
      overflow: visible;
    }}

    .caption-line {{
      position: absolute;
      left: 60px;
      right: 60px;
      bottom: 240px;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
      pointer-events: none;
      z-index: 100;
    }}

    .cw {{
      font-size: 52px;
      font-weight: 800;
      color: var(--caption-idle);
      letter-spacing: -0.5px;
    }}

    .safe-footer {{
      position: absolute;
      left: 72px;
      right: 72px;
      bottom: 120px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 24px;
      color: var(--ink-sub);
      z-index: 10;
      opacity: 0.65;
    }}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="{total_sec:.2f}">
    <div class="scene-bg"></div>
    <div class="grid-overlay"></div>

    <!-- ==================== SCENE 1: HOOK & THE PHISHING FALLACY (0.00 -> 10.50s) ==================== -->
    <div id="s1" class="clip" data-start="{S1_START:.2f}" data-duration="{S1_DUR:.2f}" data-track-index="1">
      <div class="content-layer scene-inner sc-1">
        <div class="eyebrow">CYBERSECURITY MYTH // NGHỊCH LÝ BẢO MẬT</div>
        <div class="headline">KHÔNG BẤM LINK LẠ,<br>VẪN BỊ <span class="danger">LỘ MẬT KHẨU?</span></div>

        <div class="diagram-stage">
          <div id="s1-shield-box" style="position:relative; width:100%; height:460px; display:flex; justify-content:center; align-items:center;">
            <svg viewBox="0 0 800 440" class="svg-canvas">
              <!-- Background radar pulse -->
              <circle cx="400" cy="220" r="180" fill="none" stroke="rgba(56, 189, 248, 0.15)" stroke-width="2" stroke-dasharray="6 6" />
              <circle cx="400" cy="220" r="110" fill="none" stroke="rgba(56, 189, 248, 0.2)" stroke-width="2" />

              <!-- User Safe Lock Container -->
              <g id="s1-lock-grp">
                <rect x="260" y="100" width="280" height="240" rx="20" fill="#161F30" stroke="#38BDF8" stroke-width="4" />
                <path d="M 330 100 V 50 C 330 20 470 20 470 50 V 100" fill="none" stroke="#38BDF8" stroke-width="8" stroke-linecap="round" />
                <circle cx="400" cy="200" r="24" fill="#38BDF8" />
                <rect x="392" y="200" width="16" height="60" rx="6" fill="#38BDF8" />
                <text x="400" y="305" text-anchor="middle" fill="#38BDF8" font-family="'IBM Plex Mono', monospace" font-size="22" font-weight="bold">NGƯỜI DÙNG CẨN THẬN</text>
              </g>

              <!-- Attack Vector piercing through -->
              <g id="s1-breach-path" style="opacity:0;">
                <line x1="720" y1="60" x2="480" y2="160" stroke="#EF4444" stroke-width="6" stroke-dasharray="10 6" />
                <circle cx="480" cy="160" r="18" fill="#EF4444" />
                <text x="620" y="100" fill="#EF4444" font-family="'IBM Plex Mono', monospace" font-size="22" font-weight="bold">RÒ RỈ TỪ MÁY CHỦ</text>
              </g>
            </svg>
          </div>

          <div id="s1-alert-stamp" class="stamp danger" style="opacity:0; margin-top:20px;">
            ⚠ BỊ ĐÁNH CẮP VÔ HÌNH
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 2: SERVER BREACHES & CREDENTIAL STUFFING (10.50 -> 34.30s) ==================== -->
    <div id="s2" class="clip" data-start="{S2_START:.2f}" data-duration="{S2_DUR:.2f}" data-track-index="1">
      <div class="content-layer scene-inner sc-2">
        <div class="eyebrow">CON ĐƯỜNG 01 // DATA BREACH &amp; STUFFING</div>
        <div class="headline">MÁY CHỦ BÊN THỨ 3 &amp;<br><span class="danger">CẠM BẪY DÙNG CHUNG PASS</span></div>

        <div class="diagram-stage">
          <!-- Sub-view 2A: Device Clean vs Server Breach -->
          <div id="s2-split-view" style="width:100%; display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:24px;">
            <div id="s2-dev-card" class="card" style="border-color:var(--accent-emerald);">
              <div style="font-family:'IBM Plex Mono'; font-size:24px; color:var(--accent-emerald); font-weight:700;">THIẾT BỊ BẠN</div>
              <div style="font-size:32px; font-weight:800; margin:8px 0; color:#F4F7FB;">100% SẠCH SẼ</div>
              <div style="font-size:20px; color:var(--ink-sub);">Không virus, không click link bẫy</div>
            </div>

            <div id="s2-srv-card" class="card card-danger">
              <div style="font-family:'IBM Plex Mono'; font-size:24px; color:var(--accent-danger); font-weight:700;">MÁY CHỦ WEB NHỎ</div>
              <div style="font-size:32px; font-weight:800; margin:8px 0; color:var(--accent-danger);">DATA BREACH!</div>
              <div style="font-size:20px; color:var(--ink-sub);">Bị hacker dump sạch cơ sở dữ liệu</div>
            </div>
          </div>

          <!-- Sub-view 2B: Stuffing Bot & Target accounts -->
          <div id="s2-bot-view" style="width:100%; height:380px; position:relative;">
            <svg viewBox="0 0 800 360" class="svg-canvas">
              <!-- Leaked Dump Node -->
              <rect x="40" y="80" width="200" height="180" rx="14" fill="#1E293B" stroke="#F59E0B" stroke-width="3" />
              <text x="140" y="130" text-anchor="middle" fill="#F59E0B" font-family="'IBM Plex Mono'" font-size="20" font-weight="bold">LEAKED DUMP</text>
              <text x="140" y="170" text-anchor="middle" fill="#CBD5E1" font-family="'IBM Plex Mono'" font-size="16">email@pass</text>
              <text x="140" y="210" text-anchor="middle" fill="#8B94A6" font-size="16">Lộ từ web cũ</text>

              <!-- Central Bot Engine -->
              <rect id="s2-bot-box" x="300" y="70" width="200" height="200" rx="16" fill="#1E1B4B" stroke="#818CF8" stroke-width="4" />
              <text x="400" y="130" text-anchor="middle" fill="#818CF8" font-family="'IBM Plex Mono'" font-size="28" font-weight="bold">BOT ENGINE</text>
              <text x="400" y="175" text-anchor="middle" fill="#F4F7FB" font-size="18" font-weight="bold">CREDENTIAL STUFFING</text>
              <text id="s2-bot-rate" x="400" y="225" text-anchor="middle" fill="#38BDF8" font-family="'IBM Plex Mono'" font-size="20" font-weight="bold">10,000 req/min</text>

              <!-- Target accounts -->
              <g transform="translate(560, 40)">
                <rect class="s2-target" x="0" y="0" width="200" height="70" rx="10" fill="#161F30" stroke="#EF4444" stroke-width="2" />
                <text x="100" y="42" text-anchor="middle" fill="#EF4444" font-size="20" font-weight="bold">NGÂN HÀNG 🔓</text>
              </g>

              <g transform="translate(560, 135)">
                <rect class="s2-target" x="0" y="0" width="200" height="70" rx="10" fill="#161F30" stroke="#EF4444" stroke-width="2" />
                <text x="100" y="42" text-anchor="middle" fill="#EF4444" font-size="20" font-weight="bold">HỘP THƯ CHÍNH 🔓</text>
              </g>

              <g transform="translate(560, 230)">
                <rect class="s2-target" x="0" y="0" width="200" height="70" rx="10" fill="#161F30" stroke="#EF4444" stroke-width="2" />
                <text x="100" y="42" text-anchor="middle" fill="#EF4444" font-size="20" font-weight="bold">MẠNG XÃ HỘI 🔓</text>
              </g>

              <!-- Connecting Beams -->
              <line x1="240" y1="170" x2="300" y2="170" stroke="#F59E0B" stroke-width="3" />
              <line x1="500" y1="130" x2="560" y2="75" stroke="#EF4444" stroke-width="3" stroke-dasharray="6 4" />
              <line x1="500" y1="170" x2="560" y2="170" stroke="#EF4444" stroke-width="3" stroke-dasharray="6 4" />
              <line x1="500" y1="210" x2="560" y2="265" stroke="#EF4444" stroke-width="3" stroke-dasharray="6 4" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 3: INFOSTEALER & COOKIE HIJACKING (34.30 -> 59.54s) ==================== -->
    <div id="s3" class="clip" data-start="{S3_START:.2f}" data-duration="{S3_DUR:.2f}" data-track-index="1">
      <div class="content-layer scene-inner sc-3">
        <div class="eyebrow">CON ĐƯỜNG 02 // INFOSTEALER &amp; SESSION THEFT</div>
        <div class="headline">MÃ ĐỘC TRONG APP CRACK &amp;<br><span class="danger">CƯỚP COOKIE BỎ QUA 2FA</span></div>

        <div class="diagram-stage">
          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
            <div id="s3-card-crack" class="card card-danger">
              <div style="font-family:'IBM Plex Mono'; font-size:22px; color:var(--accent-danger); font-weight:700;">NGUỒN LÂY NHIỄM ẨN</div>
              <div style="font-size:28px; font-weight:800; margin:6px 0;">Crack App / Extension</div>
              <div style="font-size:20px; color:var(--ink-sub);">RedLine, Lumma, Vidar Stealer</div>
            </div>

            <div id="s3-card-vault" class="card card-accent">
              <div style="font-family:'IBM Plex Mono'; font-size:22px; color:var(--accent); font-weight:700;">BROWSER VAULT</div>
              <div style="font-size:28px; font-weight:800; margin:6px 0;">SQLite &amp; Autofill</div>
              <div style="font-size:20px; color:var(--ink-sub);">Cào sạch pass lưu trên Chrome/Edge</div>
            </div>
          </div>

          <div style="width:100%; height:380px;">
            <svg viewBox="0 0 800 360" class="svg-canvas">
              <!-- Left: Browser Cookie Vault -->
              <rect x="60" y="80" width="280" height="200" rx="16" fill="#161F30" stroke="#38BDF8" stroke-width="3" />
              <text x="200" y="130" text-anchor="middle" fill="#38BDF8" font-family="'IBM Plex Mono'" font-size="24" font-weight="bold">ACTIVE SESSION</text>
              <rect x="90" y="160" width="220" height="48" rx="8" fill="rgba(56, 189, 248, 0.15)" stroke="#38BDF8" stroke-width="1.5" />
              <text x="200" y="190" text-anchor="middle" fill="#F4F7FB" font-family="'IBM Plex Mono'" font-size="18">session_token=xyz987</text>
              <text x="200" y="245" text-anchor="middle" fill="#8B94A6" font-size="16">Phiên làm việc đã login</text>

              <!-- Right: Attacker Machine -->
              <rect x="460" y="80" width="280" height="200" rx="16" fill="#1E1B4B" stroke="#EF4444" stroke-width="3" />
              <text x="600" y="130" text-anchor="middle" fill="#EF4444" font-family="'IBM Plex Mono'" font-size="24" font-weight="bold">MÁY HACKER</text>
              <rect x="490" y="160" width="220" height="48" rx="8" fill="rgba(239, 68, 68, 0.2)" stroke="#EF4444" stroke-width="1.5" />
              <text x="600" y="190" text-anchor="middle" fill="#EF4444" font-family="'IBM Plex Mono'" font-size="18" font-weight="bold">ĐĂNG NHẬP NGAY</text>
              <text x="600" y="245" text-anchor="middle" fill="#F87171" font-size="16">Không cần mật khẩu!</text>

              <!-- Flow Arrow transferring session -->
              <path id="s3-token-flow" d="M 340 184 L 460 184" stroke="#EF4444" stroke-width="6" stroke-dasharray="8 6" />
            </svg>
          </div>

          <div id="s3-bypass-stamp" class="stamp danger" style="opacity:0; width:100%; justify-content:center;">
            ⚡ BỎ QUA HOÀN TOÀN MÃ OTP SMS &amp; 2FA
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 4: ACTIONABLE DEFENSE & PASSKEYS (59.54 -> 84.61s) ==================== -->
    <div id="s4" class="clip" data-start="{S4_START:.2f}" data-duration="{S4_DUR:.2f}" data-track-index="1">
      <div class="content-layer scene-inner sc-4">
        <div class="eyebrow">GIẢI PHÁP THỰC CHẤT // PHÒNG THỦ CHỦ ĐỘNG</div>
        <div class="headline">BA TRỤ CỘT BẢO VỆ:<br><span class="emerald">PASSWORD MANAGER &amp; PASSKEYS</span></div>

        <div class="diagram-stage">
          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:16px; margin-bottom:24px;">
            <div id="s4-card-pm" class="card" style="padding:20px; text-align:center; border-color:var(--accent-blue);">
              <div style="font-family:'IBM Plex Mono'; font-size:20px; color:var(--accent-blue); font-weight:700;">01. MANAGER</div>
              <div style="font-size:26px; font-weight:800; margin:8px 0;">MẬT KHẨU DUY NHẤT</div>
              <div style="font-size:18px; color:var(--ink-sub);">Bitwarden, 1Password</div>
            </div>

            <div id="s4-card-pk" class="card" style="padding:20px; text-align:center; border-color:var(--accent-emerald);">
              <div style="font-family:'IBM Plex Mono'; font-size:20px; color:var(--accent-emerald); font-weight:700;">02. PASSKEYS</div>
              <div style="font-size:26px; font-weight:800; margin:8px 0; color:var(--accent-emerald);">CHUẨN FIDO2</div>
              <div style="font-size:18px; color:var(--ink-sub);">Khóa phần cứng, chống leak</div>
            </div>

            <div id="s4-card-hb" class="card" style="padding:20px; text-align:center; border-color:var(--accent-amber);">
              <div style="font-family:'IBM Plex Mono'; font-size:20px; color:var(--accent-amber); font-weight:700;">03. THEO DÕI</div>
              <div style="font-size:26px; font-weight:800; margin:8px 0;">HAVE I BEEN PWNED</div>
              <div style="font-size:18px; color:var(--ink-sub);">Kiểm tra rò rỉ định kỳ</div>
            </div>
          </div>

          <div id="s4-final-seal" class="card card-accent" style="width:100%; padding:32px; text-align:center; background:linear-gradient(180deg, #182030 0%, #121722 100%);">
            <div class="stamp emerald" style="margin:0 auto 16px auto; font-size:28px;">CHỦ ĐỘNG KHÓA MỌI CỬA DỮ LIỆU</div>
            <div style="font-size:36px; font-weight:900; color:var(--ink); margin-bottom:10px;">An toàn không chỉ là tránh click link lạ!</div>
            <div style="font-size:24px; color:var(--ink-sub);">Dùng Mật khẩu riêng biệt · Bật Passkeys · Kiểm tra định kỳ</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Audio Master -->
    <audio id="vo-master" src="voice/narration.m4a" data-start="0.00" data-volume="1"></audio>

    <!-- Karaoke Captions -->
{caption_clips_str}

    <div class="safe-footer">
      <div>CYBERSECURITY EXPLAINER // MOTIONREAL</div>
      <div>85S MASTER</div>
    </div>
  </div>

  <script src="gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({{ paused: true }});

    // Scene transition timings
    const S1_START = {S1_START:.2f};
    const S2_START = {S2_START:.2f};
    const S3_START = {S3_START:.2f};
    const S4_START = {S4_START:.2f};

    // Crossfades between inner scenes
    tl.to(".sc-1", {{ opacity: 0, duration: 0.28, ease: "none" }}, S2_START - 0.28);
    tl.set(".sc-1", {{ opacity: 0 }}, S2_START);

    tl.fromTo(".sc-2", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S2_START);
    tl.to(".sc-2", {{ opacity: 0, duration: 0.28, ease: "none" }}, S3_START - 0.28);
    tl.set(".sc-2", {{ opacity: 0 }}, S3_START);

    tl.fromTo(".sc-3", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S3_START);
    tl.to(".sc-3", {{ opacity: 0, duration: 0.28, ease: "none" }}, S4_START - 0.28);
    tl.set(".sc-3", {{ opacity: 0 }}, S4_START);

    tl.fromTo(".sc-4", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S4_START);

    // ================= Scene 1 Dynamic Animations =================
    tl.fromTo("#s1-breach-path", {{ opacity: 0, scale: 0.8 }}, {{ opacity: 1, scale: 1, duration: 0.45 }}, 2.5);
    tl.fromTo("#s1-alert-stamp", {{ opacity: 0, scale: 2.0, rotation: -12 }}, {{ opacity: 1, scale: 1, rotation: -2, duration: 0.35, ease: "back.out(1.7)" }}, 3.2);

    // ================= Scene 2 Dynamic Animations =================
    tl.fromTo("#s2-srv-card", {{ scale: 1 }}, {{ scale: 1.05, duration: 0.35, yoyo: true, repeat: 3 }}, S2_START + 2.0);
    tl.fromTo(".s2-target", {{ stroke: "#EF4444" }}, {{ stroke: "#F59E0B", duration: 0.5, stagger: 0.2, repeat: 3, yoyo: true }}, S2_START + 14.0);

    // ================= Scene 3 Dynamic Animations =================
    tl.fromTo("#s3-card-crack", {{ scale: 1 }}, {{ scale: 1.06, duration: 0.4, yoyo: true, repeat: 2 }}, S3_START + 2.0);
    tl.fromTo("#s3-bypass-stamp", {{ opacity: 0, scale: 1.9, rotation: -6 }}, {{ opacity: 1, scale: 1, rotation: -1, duration: 0.35, ease: "back.out(1.8)" }}, S3_START + 18.0);

    // ================= Scene 4 Dynamic Animations =================
    tl.fromTo("#s4-card-pm", {{ opacity: 0, y: 30 }}, {{ opacity: 1, y: 0, duration: 0.4 }}, S4_START + 0.5);
    tl.fromTo("#s4-card-pk", {{ opacity: 0, y: 30 }}, {{ opacity: 1, y: 0, duration: 0.4 }}, S4_START + 6.5);
    tl.fromTo("#s4-card-hb", {{ opacity: 0, y: 30 }}, {{ opacity: 1, y: 0, duration: 0.4 }}, S4_START + 12.5);
    tl.fromTo("#s4-final-seal", {{ opacity: 0, scale: 0.95 }}, {{ opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }}, S4_START + 18.0);

    // ================= Caption Sync Engine =================
    const cwNodes = document.querySelectorAll(".caption-line .cw");
    const CAPTION_WORDS = {caption_words_str};
    const CAPTION_ACTIVE = "#38BDF8";
    const CAPTION_IDLE = "rgba(244, 247, 251, 0.45)";

    CAPTION_WORDS.forEach(([lineIdx, wordIdx, start, end], k) => {{
      const el = cwNodes[k];
      if (!el) return;
      tl.set(el, {{ color: CAPTION_ACTIVE }}, start);
      tl.set(el, {{ color: CAPTION_IDLE }}, end);
    }});

    // Register paused timeline with HyperFrames
    window.__timelines = {{ main: tl }};
  </script>
</body>
</html>
'''

(hf_dir / "index.html").write_text(html_content, encoding="utf-8")
print(f"DONE writing starter-hf/{slug}/index.html with {len(caption_lines)} caption lines ({total_sec}s)")
