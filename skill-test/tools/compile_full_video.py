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

.card-hero {
  position: absolute;
  top: 200px;
  left: 80px;
  right: 80px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 34px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 4px;
  color: var(--accent);
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-display {
  font-family: 'Be Vietnam Pro', sans-serif;
  font-size: 58px;
  font-weight: 900;
  line-height: 1.15;
  color: var(--ink);
}

.diagram-box {
  position: absolute;
  top: 450px;
  left: 80px;
  right: 80px;
  height: 760px;
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
  top: 1250px;
  left: 80px;
  right: 80px;
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
  top: 1250px;
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
  top: 240px;
  left: 70px;
  right: 70px;
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

def get_scene_dict():
    scenes = {}
    
    # b1 to b6
    scenes["b1"] = {
        "eyebrow": "BÍ ẨN TRÍ TUỆ NHÂN TẠO",
        "title": "MÁY TÍNH CÓ BIẾT SUY NGHĨ?",
        "svg": """
          <rect x="160" y="40" width="600" height="580" rx="32" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <circle cx="460" cy="280" r="140" fill="none" stroke="#38BDF8" stroke-width="4" stroke-dasharray="8 6" />
          <circle cx="410" cy="250" r="16" fill="#60A5FA" />
          <circle cx="510" cy="250" r="16" fill="#60A5FA" />
          <path d="M 460 280 L 460 320 L 440 330" stroke="#60A5FA" stroke-width="4" fill="none" />
          <path d="M 400 370 Q 460 410 520 370" stroke="#38BDF8" stroke-width="5" fill="none" />
          <g id="b1-bbox">
            <rect x="260" y="100" width="400" height="420" rx="16" fill="none" stroke="#4ADE80" stroke-width="5" />
            <rect x="260" y="100" width="220" height="50" rx="8" fill="#15803D" />
            <text x="370" y="135" class="svg-text-bold" fill="#F0FDF4" font-size="28">FACE: 99.8%</text>
          </g>
          <line id="b1-laser" x1="180" y1="120" x2="740" y2="120" stroke="#38BDF8" stroke-width="6" opacity="0.8" />
        """,
        "pill": '<span class="mono-accent">0.001 GIÂY</span> <span class="text-sub">| TỐC ĐỘ NHẬN DIỆN KHUÔN MẶT</span>'
    }

    scenes["b2"] = {
        "eyebrow": "BƯỚC CHUYỂN VĨ ĐẠI",
        "title": "KHÔNG PHẢI CODE IF-ELSE",
        "svg": """
          <g id="b2-old" transform="translate(60, 60)">
            <rect width="360" height="420" rx="24" fill="#1E1E2E" stroke="#EF4444" stroke-width="3" />
            <text x="180" y="60" class="svg-text-bold" fill="#EF4444">1,000,000 DÒNG</text>
            <text x="180" y="100" class="svg-text-mono" fill="#8B94A6">IF / ELSE THỦ CÔNG</text>
            <line x1="40" y1="130" x2="320" y2="130" stroke="#334155" stroke-width="2" />
            <text x="60" y="180" class="svg-text-mono" fill="#F87171" font-size="24">if (face_shape == 1)</text>
            <text x="60" y="230" class="svg-text-mono" fill="#F87171" font-size="24">if (skin_tone &gt; 0.5)</text>
            <text x="60" y="280" class="svg-text-mono" fill="#F87171" font-size="24">if (eye_dist == 42)</text>
            <text x="60" y="340" class="svg-text-bold" fill="#EF4444" font-size="28">// BẤT KHẢ THI!</text>
            <line id="b2-cross1" x1="20" y1="20" x2="340" y2="400" stroke="#EF4444" stroke-width="8" stroke-linecap="round" />
            <line id="b2-cross2" x1="340" y1="20" x2="20" y2="400" stroke="#EF4444" stroke-width="8" stroke-linecap="round" />
          </g>
          <g id="b2-new" transform="translate(500, 60)">
            <rect width="360" height="420" rx="24" fill="#0F2942" stroke="#38BDF8" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#38BDF8">MACHINE LEARNING</text>
            <text x="180" y="100" class="svg-text-mono" fill="#93C5FD">TỰ HỌC QUY LUẬT</text>
            <line x1="40" y1="130" x2="320" y2="130" stroke="#1E40AF" stroke-width="2" />
            <rect x="60" y="160" width="240" height="150" rx="16" fill="#1E3A8A" stroke="#60A5FA" stroke-width="2" />
            <text x="180" y="220" class="svg-text-bold" fill="#F4F7FB" font-size="32">W &middot; X + B</text>
            <text x="180" y="270" class="svg-text-mono" fill="#93C5FD" font-size="24">TRỌNG SỐ MA TRẬN</text>
            <text x="180" y="365" class="svg-text-bold" fill="#34D399" font-size="30">&checkmark; TỰ ĐỘNG HÓA</text>
          </g>
          <path d="M 430 270 L 490 270" stroke="#FBBF24" stroke-width="6" stroke-dasharray="8 6" />
        """,
        "badge": "MÔ HÌNH THAY VÌ LỆNH CỨNG"
    }

    scenes["b3"] = {
        "eyebrow": "MÔ HÌNH CŨ",
        "title": "LẬP TRÌNH TRUYỀN THỐNG",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="160" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
            <text x="180" y="70" class="svg-text-bold" fill="#60A5FA">1. DỮ LIỆU (DATA)</text>
            <text x="180" y="115" class="svg-text-mono" fill="#8B94A6">Thông tin đầu vào</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="160" rx="20" fill="#1E293B" stroke="#F59E0B" stroke-width="4" />
            <text x="180" y="70" class="svg-text-bold" fill="#F59E0B">2. QUY TẮC (RULES)</text>
            <text x="180" y="115" class="svg-text-mono" fill="#8B94A6">Code logic con người viết</text>
          </g>
          <path d="M 240 240 L 240 330 L 400 330" stroke="#60A5FA" stroke-width="6" fill="none" />
          <path d="M 680 240 L 680 330 L 520 330" stroke="#F59E0B" stroke-width="6" fill="none" />
          <g transform="translate(280, 260)">
            <rect width="360" height="150" rx="24" fill="#0F172A" stroke="#F4F7FB" stroke-width="4" />
            <text x="180" y="70" class="svg-text-bold" fill="#F4F7FB">MÁY TÍNH (CPU)</text>
            <text x="180" y="110" class="svg-text-mono" fill="#8B94A6">Thực thi lệnh tuần tự</text>
          </g>
          <path d="M 460 410 L 460 490" stroke="#34D399" stroke-width="8" stroke-dasharray="10 8" />
          <g transform="translate(230, 490)">
            <rect width="460" height="130" rx="24" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="230" y="65" class="svg-text-bold" fill="#34D399">KẾT QUẢ ĐẦU RA (OUTPUT)</text>
            <text x="230" y="100" class="svg-text-mono" fill="#A7F3D0">Đáp án tính toán</text>
          </g>
        """,
        "pill": '<span class="text-sub">CÔNG THỨC:</span> <span class="mono-accent">DATA + RULES = OUTPUT</span>'
    }

    scenes["b4"] = {
        "eyebrow": "TƯ DUY ĐỘT PHÁ",
        "title": "ĐẢO NGƯỢC PHƯƠNG TRÌNH",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="160" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
            <text x="180" y="70" class="svg-text-bold" fill="#60A5FA">1. DỮ LIỆU (DATA)</text>
            <text x="180" y="115" class="svg-text-mono" fill="#8B94A6">Hàng ngàn ví dụ mẫu</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="160" rx="20" fill="#1E293B" stroke="#34D399" stroke-width="4" />
            <text x="180" y="70" class="svg-text-bold" fill="#34D399">2. KẾT QUẢ THỰC TẾ</text>
            <text x="180" y="115" class="svg-text-mono" fill="#8B94A6">Đáp án chuẩn (Ground Truth)</text>
          </g>
          <path d="M 240 240 L 240 330 L 380 330" stroke="#60A5FA" stroke-width="6" fill="none" />
          <path d="M 680 240 L 680 330 L 540 330" stroke="#34D399" stroke-width="6" fill="none" />
          <g transform="translate(260, 260)">
            <rect width="400" height="150" rx="24" fill="#1E3A8A" stroke="#60A5FA" stroke-width="4" />
            <text x="200" y="70" class="svg-text-bold" fill="#F4F7FB">THUẬT TOÁN HỌC MÁY</text>
            <text x="200" y="110" class="svg-text-mono" fill="#93C5FD">Tự động tìm kiếm mẫu hình</text>
          </g>
          <path d="M 460 410 L 460 490" stroke="#F59E0B" stroke-width="8" stroke-dasharray="10 8" />
          <g transform="translate(200, 490)">
            <rect width="520" height="130" rx="24" fill="#78350F" stroke="#F59E0B" stroke-width="5" />
            <text x="260" y="65" class="svg-text-bold" fill="#FDE68A">MÔ HÌNH QUY TẮC (MODEL)</text>
            <text x="260" y="100" class="svg-text-mono" fill="#FCD34D">ĐƯỢC TỰ ĐỘNG SUY RA</text>
          </g>
        """,
        "pill": '<span class="text-sub">CÔNG THỨC ML:</span> <span class="mono-accent">DATA + OUTPUT = RULES</span>'
    }

    scenes["b5"] = {
        "is_quote": True,
        "tag": "ARTHUR SAMUEL &middot; IBM 1959",
        "text": "&ldquo;Học máy là lĩnh vực nghiên cứu trao cho máy tính khả năng tự học mà không cần lập trình chi tiết từng bước.&rdquo;",
        "author": "&mdash; BÀI BÁO CỜ ĐAM KINH ĐIỂN, IBM JOURNAL 1959",
        "svg": """
          <g transform="translate(260, 20)">
            <rect width="400" height="360" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
            <rect x="40" y="40" width="70" height="70" fill="#334155" />
            <rect x="110" y="40" width="70" height="70" fill="#0F172A" />
            <rect x="180" y="40" width="70" height="70" fill="#334155" />
            <rect x="250" y="40" width="70" height="70" fill="#0F172A" />
            <circle cx="145" cy="75" r="24" fill="#EF4444" stroke="#FCA5A5" stroke-width="3" />
            <circle cx="285" cy="75" r="24" fill="#EF4444" stroke="#FCA5A5" stroke-width="3" />
            <circle cx="75" cy="145" r="24" fill="#60A5FA" stroke="#BAE6FD" stroke-width="3" />
            <text x="200" y="320" class="svg-text-bold" fill="#60A5FA">MÁY ĐÁNH CỜ TỰ HỌC ĐẦU TIÊN</text>
          </g>
        """,
        "badge": "NGUỒN GỐC THUẬT NGỮ 1959"
    }

    scenes["b6"] = {
        "eyebrow": "ĐỊNH NGHĨA TOÁN HỌC (1997)",
        "title": "BỘ BA TOM MITCHELL",
        "svg": """
          <g transform="translate(60, 60)">
            <rect width="240" height="200" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
            <text x="120" y="80" class="svg-text-bold" fill="#60A5FA" font-size="64">T</text>
            <text x="120" y="130" class="svg-text-bold" fill="#F4F7FB">TASK</text>
            <text x="120" y="165" class="svg-text-mono" fill="#8B94A6">Nhiệm vụ cụ thể</text>
          </g>
          <g transform="translate(340, 60)">
            <rect width="240" height="200" rx="20" fill="#1E293B" stroke="#34D399" stroke-width="4" />
            <text x="120" y="80" class="svg-text-bold" fill="#34D399" font-size="64">P</text>
            <text x="120" y="130" class="svg-text-bold" fill="#F4F7FB">PERFORMANCE</text>
            <text x="120" y="165" class="svg-text-mono" fill="#8B94A6">Thước đo hiệu năng</text>
          </g>
          <g transform="translate(620, 60)">
            <rect width="240" height="200" rx="20" fill="#1E293B" stroke="#F59E0B" stroke-width="4" />
            <text x="120" y="80" class="svg-text-bold" fill="#F59E0B" font-size="64">E</text>
            <text x="120" y="130" class="svg-text-bold" fill="#F4F7FB">EXPERIENCE</text>
            <text x="120" y="165" class="svg-text-mono" fill="#8B94A6">Trải nghiệm dữ liệu</text>
          </g>
          <g transform="translate(60, 320)">
            <rect width="800" height="300" rx="24" fill="#0F172A" stroke="#334155" stroke-width="3" />
            <text x="50" y="50" class="svg-text-mono" fill="#8B94A6">HIỆU NĂNG P TĂNG THEO TRẢI NGHIỆM E</text>
            <line x1="100" y1="240" x2="740" y2="240" stroke="#64748B" stroke-width="3" />
            <line x1="100" y1="240" x2="100" y2="80" stroke="#64748B" stroke-width="3" />
            <path d="M 100 230 Q 300 210 450 140 T 720 90" fill="none" stroke="#34D399" stroke-width="6" />
            <rect x="520" y="70" width="200" height="60" rx="12" fill="#064E3B" stroke="#34D399" stroke-width="2" />
            <text x="620" y="110" class="svg-text-bold" fill="#34D399" font-size="32">P = 98.5%</text>
          </g>
        """,
        "pill": '<span class="text-sub">NGUYÊN LÝ:</span> <span class="mono-accent">P CÀNG CAO KHI E CÀNG TĂNG</span>'
    }

    # b7 to b14: Supervised Learning Deep Dive
    scenes["b7"] = {
        "eyebrow": "BẢN CHẤT HỌC MÁY",
        "title": "CỖ MÁY ĐANG THỰC SỰ HỌC?",
        "svg": """
          <rect x="80" y="60" width="760" height="520" rx="32" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(140, 120)">
            <circle cx="60" cy="60" r="40" fill="#1E3A8A" stroke="#60A5FA" stroke-width="3" />
            <text x="60" y="70" class="svg-text-bold" fill="#60A5FA" font-size="32">1</text>
            <text x="140" y="50" class="svg-text-bold" fill="#F4F7FB" font-size="32">Nhận nhiệm vụ T</text>
            <text x="140" y="85" class="svg-text-mono" fill="#8B94A6">Phân loại ảnh, dịch thuật, lái xe</text>
          </g>
          <g transform="translate(140, 260)">
            <circle cx="60" cy="60" r="40" fill="#064E3B" stroke="#34D399" stroke-width="3" />
            <text x="60" y="70" class="svg-text-bold" fill="#34D399" font-size="32">2</text>
            <text x="140" y="50" class="svg-text-bold" fill="#F4F7FB" font-size="32">Thu nạp trải nghiệm E</text>
            <text x="140" y="85" class="svg-text-mono" fill="#8B94A6">Hàng triệu mẫu dữ liệu thực tế</text>
          </g>
          <g transform="translate(140, 400)">
            <circle cx="60" cy="60" r="40" fill="#78350F" stroke="#F59E0B" stroke-width="3" />
            <text x="60" y="70" class="svg-text-bold" fill="#F59E0B" font-size="32">3</text>
            <text x="140" y="50" class="svg-text-bold" fill="#F4F7FB" font-size="32">Tăng trưởng hiệu năng P</text>
            <text x="140" y="85" class="svg-text-mono" fill="#8B94A6">Độ chính xác ngày càng hoàn hảo</text>
          </g>
        """,
        "badge": "ĐIỀU KIỆN TIÊN QUYẾT CỦA ML"
    }

    scenes["b8"] = {
        "eyebrow": "BỨC TRANH TOÀN CẢNH",
        "title": "3 TRỤ CỘT MACHINE LEARNING",
        "svg": """
          <g transform="translate(40, 60)">
            <rect width="260" height="540" rx="24" fill="#0F2942" stroke="#38BDF8" stroke-width="4" />
            <rect x="20" y="20" width="220" height="60" rx="12" fill="#0284C7" />
            <text x="130" y="58" class="svg-text-bold" fill="#F0F9FF" font-size="24">SUPERVISED</text>
            <text x="130" y="120" class="svg-text-bold" fill="#38BDF8" font-size="28">CÓ GIÁM SÁT</text>
            <text x="130" y="200" class="svg-text-mono" fill="#BAE6FD">&bull; Phân loại</text>
            <text x="130" y="250" class="svg-text-mono" fill="#BAE6FD">&bull; Hồi quy</text>
          </g>
          <g transform="translate(330, 60)">
            <rect width="260" height="540" rx="24" fill="#2E1065" stroke="#A855F7" stroke-width="4" />
            <rect x="20" y="20" width="220" height="60" rx="12" fill="#7E22CE" />
            <text x="130" y="58" class="svg-text-bold" fill="#FAF5FF" font-size="24">UNSUPERVISED</text>
            <text x="130" y="120" class="svg-text-bold" fill="#C084FC" font-size="28">KHÔNG GIÁM SÁT</text>
            <text x="130" y="200" class="svg-text-mono" fill="#E9D5FF">&bull; Phân cụm</text>
            <text x="130" y="250" class="svg-text-mono" fill="#E9D5FF">&bull; Giảm chiều</text>
          </g>
          <g transform="translate(620, 60)">
            <rect width="260" height="540" rx="24" fill="#431407" stroke="#F97316" stroke-width="4" />
            <rect x="20" y="20" width="220" height="60" rx="12" fill="#C2410C" />
            <text x="130" y="58" class="svg-text-bold" fill="#FFF7ED" font-size="22">REINFORCEMENT</text>
            <text x="130" y="120" class="svg-text-bold" fill="#FB923C" font-size="28">TĂNG CƯỜNG</text>
            <text x="130" y="200" class="svg-text-mono" fill="#FFEDD5">&bull; Tác tử (Agent)</text>
            <text x="130" y="250" class="svg-text-mono" fill="#FFEDD5">&bull; Thưởng / Phạt</text>
          </g>
        """,
        "pill": '<span class="text-sub">HỆ THỐNG PHÂN LOẠI CHUẨN CỦA AI HIỆN ĐẠI</span>'
    }

    scenes["b9"] = {
        "eyebrow": "TRỤ CỘT THỨ NHẤT",
        "title": "HỌC CÓ GIÁM SÁT (SUPERVISED)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#38BDF8" stroke-width="4" />
          <g transform="translate(100, 100)">
            <rect width="320" height="180" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="160" y="70" class="svg-text-bold" fill="#F4F7FB" font-size="32">[ẢNH CON MÈO]</text>
            <rect x="60" y="110" width="200" height="45" rx="8" fill="#0284C7" />
            <text x="160" y="142" class="svg-text-bold" fill="#F0F9FF" font-size="24">NHÃN: "MÈO"</text>
          </g>
          <g transform="translate(500, 100)">
            <rect width="320" height="180" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="160" y="70" class="svg-text-bold" fill="#F4F7FB" font-size="32">[ẢNH CON CHÓ]</text>
            <rect x="60" y="110" width="200" height="45" rx="8" fill="#0284C7" />
            <text x="160" y="142" class="svg-text-bold" fill="#F0F9FF" font-size="24">NHÃN: "CHÓ"</text>
          </g>
          <path d="M 260 290 L 260 380 L 400 380" stroke="#38BDF8" stroke-width="6" fill="none" />
          <path d="M 660 290 L 660 380 L 520 380" stroke="#38BDF8" stroke-width="6" fill="none" />
          <g transform="translate(260, 340)">
            <rect width="400" height="140" rx="20" fill="#0369A1" stroke="#38BDF8" stroke-width="4" />
            <text x="200" y="65" class="svg-text-bold" fill="#F0F9FF" font-size="28">MÔ HÌNH HUẤN LUYỆN</text>
            <text x="200" y="105" class="svg-text-mono" fill="#BAE6FD">Học quan hệ X &rarr; Y</text>
          </g>
          <text x="460" y="540" class="svg-text-bold" fill="#34D399" font-size="28">&checkmark; CÓ ĐÁP ÁN ĐỐI CHIẾU TRỰC TIẾP</text>
        """,
        "badge": "DỮ LIỆU ĐƯỢC GÁN NHÃN (LABELED)"
    }

    scenes["b10"] = {
        "is_quote": True,
        "tag": "NGUYÊN LÝ GROUND TRUTH",
        "text": "&ldquo;Mỗi cặp dữ liệu (Đầu vào X, Nhãn Y) đóng vai trò như một bài thi kèm đáp án mẫu chuẩn xác 100%.&rdquo;",
        "author": "&mdash; BÀI HỌC CÓ HƯỚNG DẪN TỪ ĐÁP ÁN THỰC TẾ",
        "svg": """
          <g transform="translate(160, 40)">
            <rect width="600" height="300" rx="24" fill="#0F172A" stroke="#34D399" stroke-width="4" />
            <text x="300" y="60" class="svg-text-bold" fill="#34D399" font-size="32">BẢNG DỮ LIỆU HUẤN LUYỆN (X, y)</text>
            <line x1="40" y1="90" x2="560" y2="90" stroke="#334155" stroke-width="2" />
            <text x="60" y="140" class="svg-text-mono" fill="#F4F7FB" font-size="26">X1: [Diện tích: 80m&sup2;] &rarr; y1: 3.2 Tỷ &checkmark;</text>
            <text x="60" y="190" class="svg-text-mono" fill="#F4F7FB" font-size="26">X2: [Diện tích: 120m&sup2;] &rarr; y2: 5.1 Tỷ &checkmark;</text>
            <text x="60" y="240" class="svg-text-mono" fill="#F4F7FB" font-size="26">X3: [Diện tích: 45m&sup2;] &rarr; y3: 1.8 Tỷ &checkmark;</text>
          </g>
        """,
        "badge": "CẶP ĐẶC TRƯNG &amp; NHÃN ĐÍCH"
    }

    scenes["b11"] = {
        "eyebrow": "HAI BÀI TOÁN CỐT LÕI",
        "title": "CLASSIFICATION VS REGRESSION",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#1E293B" stroke="#38BDF8" stroke-width="4" />
            <rect x="30" y="30" width="300" height="60" rx="12" fill="#0284C7" />
            <text x="180" y="68" class="svg-text-bold" fill="#F0F9FF" font-size="28">1. PHÂN LOẠI</text>
            <text x="180" y="140" class="svg-text-mono" fill="#38BDF8" font-size="24">CLASSIFICATION</text>
            <line x1="40" y1="170" x2="320" y2="170" stroke="#334155" stroke-width="2" />
            <text x="180" y="230" class="svg-text-bold" fill="#F4F7FB" font-size="28">Đầu ra: RỜI RẠC</text>
            <text x="180" y="280" class="svg-text-mono" fill="#94A3B8">Mèo hay Chó?</text>
            <text x="180" y="320" class="svg-text-mono" fill="#94A3B8">Spam hay Thường?</text>
            <text x="180" y="360" class="svg-text-mono" fill="#94A3B8">Gian lận hay Hợp lệ?</text>
            <rect x="40" y="400" width="280" height="50" rx="10" fill="#0369A1" />
            <text x="180" y="432" class="svg-text-bold" fill="#F0F9FF" font-size="22">DỰ ĐOÁN NHÃN LỚP</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#1E293B" stroke="#34D399" stroke-width="4" />
            <rect x="30" y="30" width="300" height="60" rx="12" fill="#059669" />
            <text x="180" y="68" class="svg-text-bold" fill="#F0FDF4" font-size="28">2. HỒI QUY</text>
            <text x="180" y="140" class="svg-text-mono" fill="#34D399" font-size="24">REGRESSION</text>
            <line x1="40" y1="170" x2="320" y2="170" stroke="#334155" stroke-width="2" />
            <text x="180" y="230" class="svg-text-bold" fill="#F4F7FB" font-size="28">Đầu ra: LIÊN TỤC</text>
            <text x="180" y="280" class="svg-text-mono" fill="#94A3B8">Giá nhà: 4.8 Tỷ</text>
            <text x="180" y="320" class="svg-text-mono" fill="#94A3B8">Nhiệt độ: 32.5&deg;C</text>
            <text x="180" y="360" class="svg-text-mono" fill="#94A3B8">Doanh số: $1.2M</text>
            <rect x="40" y="400" width="280" height="50" rx="10" fill="#047857" />
            <text x="180" y="432" class="svg-text-bold" fill="#F0FDF4" font-size="22">DỰ ĐOÁN GIÁ TRỊ SỐ</text>
          </g>
        """,
        "badge": "HAI DẠNG ĐẦU RA KINH ĐIỂN CỦA ML"
    }

    scenes["b12"] = {
        "eyebrow": "VÍ DỤ PHÂN LOẠI",
        "title": "BỘ LỌC THƯ RÁC (SPAM FILTER)",
        "svg": """
          <rect x="80" y="60" width="760" height="520" rx="28" fill="#0F172A" stroke="#38BDF8" stroke-width="4" />
          <g transform="translate(140, 100)">
            <rect width="640" height="120" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="140" y="65" class="svg-text-bold" fill="#F4F7FB" font-size="28">[EMAIL ĐẾN]</text>
            <text x="420" y="65" class="svg-text-mono" fill="#93C5FD" font-size="24">Trúng thưởng 10 tỷ!</text>
          </g>
          <path d="M 460 220 L 460 300" stroke="#38BDF8" stroke-width="8" stroke-dasharray="10 6" />
          <g transform="translate(140, 300)">
            <rect width="640" height="100" rx="16" fill="#1E3A8A" stroke="#38BDF8" stroke-width="4" />
            <text x="320" y="55" class="svg-text-bold" fill="#F0F9FF" font-size="28">BỘ PHÂN LOẠI ML QUÉT NỘI DUNG</text>
          </g>
          <path d="M 280 400 L 280 480" stroke="#EF4444" stroke-width="6" />
          <path d="M 640 400 L 640 480" stroke="#34D399" stroke-width="6" />
          <g transform="translate(140, 480)">
            <rect width="280" height="80" rx="12" fill="#7F1D1D" stroke="#EF4444" stroke-width="3" />
            <text x="140" y="45" class="svg-text-bold" fill="#FCA5A5" font-size="26">&cross; SPAM (99.4%)</text>
          </g>
          <g transform="translate(500, 480)">
            <rect width="280" height="80" rx="12" fill="#064E3B" stroke="#34D399" stroke-width="3" />
            <text x="140" y="45" class="svg-text-bold" fill="#86EFAC" font-size="26">&checkmark; INBOX (0.6%)</text>
          </g>
        """,
        "pill": '<span class="mono-accent">BÀI TOÁN PHÂN LOẠI NHỊ PHÂN (BINARY)</span>'
    }

    scenes["b13"] = {
        "eyebrow": "THUẬT TOÁN TIÊU BIỂU",
        "title": "4 BỘ KHỞI NGUYÊN PHÂN LOẠI",
        "svg": """
          <g transform="translate(60, 60)">
            <rect width="380" height="240" rx="20" fill="#1E293B" stroke="#38BDF8" stroke-width="3" />
            <text x="190" y="60" class="svg-text-bold" fill="#38BDF8" font-size="28">1. DECISION TREE</text>
            <text x="190" y="100" class="svg-text-mono" fill="#8B94A6">Cây quyết định phân nhánh</text>
            <text x="190" y="160" class="svg-text-mono" fill="#F4F7FB">if A &gt; 5 &rarr; Nhánh Trái</text>
            <text x="190" y="200" class="svg-text-mono" fill="#F4F7FB">else &rarr; Nhánh Phải</text>
          </g>
          <g transform="translate(480, 60)">
            <rect width="380" height="240" rx="20" fill="#1E293B" stroke="#38BDF8" stroke-width="3" />
            <text x="190" y="60" class="svg-text-bold" fill="#38BDF8" font-size="28">2. RANDOM FOREST</text>
            <text x="190" y="100" class="svg-text-mono" fill="#8B94A6">Rừng ngẫu nhiên đa cây</text>
            <text x="190" y="160" class="svg-text-mono" fill="#F4F7FB">Gom 100 cây quyết định</text>
            <text x="190" y="200" class="svg-text-mono" fill="#34D399">Bỏ phiếu số đông</text>
          </g>
          <g transform="translate(60, 340)">
            <rect width="380" height="240" rx="20" fill="#1E293B" stroke="#38BDF8" stroke-width="3" />
            <text x="190" y="60" class="svg-text-bold" fill="#38BDF8" font-size="28">3. SVM (VECTOR MÁY)</text>
            <text x="190" y="100" class="svg-text-mono" fill="#8B94A6">Support Vector Machine</text>
            <text x="190" y="160" class="svg-text-mono" fill="#F4F7FB">Tìm siêu phẳng phân cách</text>
            <text x="190" y="200" class="svg-text-mono" fill="#FBBF24">Tối đa hóa Margin</text>
          </g>
          <g transform="translate(480, 340)">
            <rect width="380" height="240" rx="20" fill="#1E293B" stroke="#38BDF8" stroke-width="3" />
            <text x="190" y="60" class="svg-text-bold" fill="#38BDF8" font-size="28">4. LOGISTIC REGRESSION</text>
            <text x="190" y="100" class="svg-text-mono" fill="#8B94A6">Hồi quy Logistic</text>
            <text x="190" y="160" class="svg-text-mono" fill="#F4F7FB">Hàm Sigmoid (0 &rarr; 1)</text>
            <text x="190" y="200" class="svg-text-mono" fill="#A78BFA">Ước tính xác suất</text>
          </g>
        """,
        "badge": "VŨ KHÍ NỀN TẢNG CỦA DATA SCIENTIST"
    }

    scenes["b14"] = {
        "eyebrow": "VÍ DỤ HỒI QUY",
        "title": "DỰ ĐOÁN GIÁ BẤT ĐỘNG SẢN",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#34D399" stroke-width="4" />
          <g transform="translate(100, 80)">
            <line x1="80" y1="400" x2="680" y2="400" stroke="#64748B" stroke-width="4" />
            <line x1="80" y1="400" x2="80" y2="80" stroke="#64748B" stroke-width="4" />
            <circle cx="160" cy="340" r="12" fill="#38BDF8" />
            <circle cx="240" cy="300" r="12" fill="#38BDF8" />
            <circle cx="320" cy="240" r="12" fill="#38BDF8" />
            <circle cx="440" cy="180" r="12" fill="#38BDF8" />
            <circle cx="560" cy="120" r="12" fill="#38BDF8" />
            <circle cx="640" cy="90" r="12" fill="#38BDF8" />
            <line x1="80" y1="380" x2="680" y2="80" stroke="#34D399" stroke-width="6" />
            <rect x="420" y="220" width="220" height="80" rx="16" fill="#064E3B" stroke="#34D399" stroke-width="3" />
            <text x="530" y="255" class="svg-text-mono" fill="#86EFAC" font-size="20">DỰ BÁO: 100m&sup2;</text>
            <text x="530" y="285" class="svg-text-bold" fill="#34D399" font-size="26">GIÁ: 4.5 TỶ</text>
          </g>
        """,
        "pill": '<span class="text-sub">MÔ HÌNH ĐƯỜNG THẲNG:</span> <span class="mono-accent">y = w &middot; x + b</span>'
    }

    # b15 to b19: Unsupervised Learning
    scenes["b15"] = {
        "eyebrow": "TRỤ CỘT THỨ HAI",
        "title": "HỌC KHÔNG GIÁM SÁT (UNSUPERVISED)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#180B2B" stroke="#A855F7" stroke-width="4" />
          <g transform="translate(100, 80)">
            <text x="360" y="60" class="svg-text-bold" fill="#D8B4FE" font-size="32">ĐẠI DƯƠNG DỮ LIỆU KHÔNG NHÃN</text>
            <circle cx="140" cy="180" r="16" fill="#94A3B8" />
            <circle cx="220" cy="240" r="16" fill="#94A3B8" />
            <circle cx="180" cy="320" r="16" fill="#94A3B8" />
            <circle cx="360" cy="160" r="16" fill="#94A3B8" />
            <circle cx="420" cy="220" r="16" fill="#94A3B8" />
            <circle cx="560" cy="300" r="16" fill="#94A3B8" />
            <circle cx="620" cy="240" r="16" fill="#94A3B8" />
            <circle cx="580" cy="180" r="16" fill="#94A3B8" />
            <rect x="180" y="380" width="360" height="70" rx="16" fill="#3B0764" stroke="#A855F7" stroke-width="3" />
            <text x="360" y="422" class="svg-text-bold" fill="#F3E8FF" font-size="26">KHÔNG CÓ NGƯỜI CHẤM ĐIỂM</text>
          </g>
        """,
        "badge": "DỮ LIỆU THÔ CHƯA QUA XỬ LÝ (UNLABELED)"
    }

    scenes["b16"] = {
        "eyebrow": "CƠ CHẾ TỰ THÂN",
        "title": "TỰ TÌM CẤU TRÚC ẨN",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#A855F7" stroke-width="4" />
          <circle cx="460" cy="320" r="220" fill="none" stroke="#A855F7" stroke-width="3" stroke-dasharray="10 8" />
          <circle cx="460" cy="320" r="140" fill="none" stroke="#C084FC" stroke-width="2" />
          <line x1="460" y1="320" x2="640" y2="200" stroke="#E9D5FF" stroke-width="4" />
          <circle cx="280" cy="240" r="18" fill="#38BDF8" />
          <circle cx="320" cy="290" r="18" fill="#38BDF8" />
          <circle cx="600" cy="380" r="18" fill="#F59E0B" />
          <circle cx="650" cy="340" r="18" fill="#F59E0B" />
          <rect x="220" y="520" width="480" height="60" rx="12" fill="#581C87" />
          <text x="460" y="555" class="svg-text-bold" fill="#FAF5FF" font-size="24">ĐO LƯỜNG KHOẢNG CÁCH EUCLIDEAN</text>
        """,
        "pill": '<span class="text-sub">QUY TẮC:</span> <span class="mono-accent">GẦN NHAU THÌ CÙNG BẢN CHẤT</span>'
    }

    scenes["b17"] = {
        "eyebrow": "HAI ỨNG DỤNG LỚN",
        "title": "CLUSTERING &amp; DIMENSIONALITY",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#1E293B" stroke="#A855F7" stroke-width="4" />
            <rect x="30" y="30" width="300" height="60" rx="12" fill="#7E22CE" />
            <text x="180" y="68" class="svg-text-bold" fill="#FAF5FF" font-size="28">1. PHÂN CỤM</text>
            <text x="180" y="140" class="svg-text-mono" fill="#C084FC" font-size="24">CLUSTERING</text>
            <line x1="40" y1="170" x2="320" y2="170" stroke="#334155" stroke-width="2" />
            <text x="180" y="240" class="svg-text-bold" fill="#F4F7FB" font-size="28">Gom nhóm tự động</text>
            <text x="180" y="290" class="svg-text-mono" fill="#94A3B8">Phân khúc khách hàng</text>
            <text x="180" y="330" class="svg-text-mono" fill="#94A3B8">Phát hiện gian lận</text>
            <text x="180" y="370" class="svg-text-mono" fill="#94A3B8">Gợi ý sản phẩm</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#1E293B" stroke="#38BDF8" stroke-width="4" />
            <rect x="30" y="30" width="300" height="60" rx="12" fill="#0284C7" />
            <text x="180" y="68" class="svg-text-bold" fill="#F0F9FF" font-size="26">2. GIẢM CHIỀU</text>
            <text x="180" y="140" class="svg-text-mono" fill="#38BDF8" font-size="22">DIMENSIONALITY</text>
            <line x1="40" y1="170" x2="320" y2="170" stroke="#334155" stroke-width="2" />
            <text x="180" y="240" class="svg-text-bold" fill="#F4F7FB" font-size="28">Nén đặc trưng</text>
            <text x="180" y="290" class="svg-text-mono" fill="#94A3B8">1,000 chiều &rarr; 2D</text>
            <text x="180" y="330" class="svg-text-mono" fill="#94A3B8">Trực quan hóa đồ thị</text>
            <text x="180" y="370" class="svg-text-mono" fill="#94A3B8">Lọc nhiễu dữ liệu</text>
          </g>
        """,
        "badge": "CÔNG CỤ KHÁM PHÁ DỮ LIỆU ĐỈNH CAO"
    }

    scenes["b18"] = {
        "eyebrow": "THUẬT TOÁN K-MEANS",
        "title": "PHÂN KHÚC KHÁCH HÀNG TỰ ĐỘNG",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#A855F7" stroke-width="4" />
          <g transform="translate(100, 80)">
            <g transform="translate(80, 80)">
              <circle cx="60" cy="60" r="20" fill="#38BDF8" />
              <circle cx="110" cy="90" r="20" fill="#38BDF8" />
              <circle cx="40" cy="120" r="20" fill="#38BDF8" />
              <rect x="0" y="160" width="160" height="40" rx="8" fill="#0369A1" />
              <text x="80" y="185" class="svg-text-bold" fill="#F0F9FF" font-size="18">NHÓM TRẺ TUỔI</text>
            </g>
            <g transform="translate(420, 80)">
              <circle cx="60" cy="60" r="20" fill="#F59E0B" />
              <circle cx="110" cy="90" r="20" fill="#F59E0B" />
              <circle cx="40" cy="120" r="20" fill="#F59E0B" />
              <rect x="0" y="160" width="160" height="40" rx="8" fill="#B45309" />
              <text x="80" y="185" class="svg-text-bold" fill="#FEF3C7" font-size="18">NHÓM VIP</text>
            </g>
            <g transform="translate(250, 260)">
              <circle cx="60" cy="60" r="20" fill="#34D399" />
              <circle cx="110" cy="90" r="20" fill="#34D399" />
              <circle cx="40" cy="120" r="20" fill="#34D399" />
              <rect x="0" y="160" width="160" height="40" rx="8" fill="#047857" />
              <text x="80" y="185" class="svg-text-bold" fill="#D1FAE5" font-size="18">TIẾT KIỆM</text>
            </g>
          </g>
        """,
        "badge": "K = 3 CỤM MỤC TIÊU CHIẾN LƯỢC"
    }

    scenes["b19"] = {
        "eyebrow": "GIẢM CHIỀU DỮ LIỆU",
        "title": "THUẬT TOÁN PCA (NÉN KHÔNG GIAN)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(100, 80)">
            <g transform="translate(40, 80)">
              <rect width="240" height="240" rx="20" fill="#1E293B" stroke="#EF4444" stroke-width="3" />
              <text x="120" y="100" class="svg-text-bold" fill="#EF4444" font-size="48">500</text>
              <text x="120" y="150" class="svg-text-bold" fill="#F4F7FB">CHIỀU ĐẶC TRƯNG</text>
              <text x="120" y="190" class="svg-text-mono" fill="#8B94A6">Quá tải tính toán</text>
            </g>
            <path d="M 330 200 L 410 200" stroke="#FBBF24" stroke-width="8" />
            <g transform="translate(440, 80)">
              <rect width="240" height="240" rx="20" fill="#064E3B" stroke="#34D399" stroke-width="3" />
              <text x="120" y="100" class="svg-text-bold" fill="#34D399" font-size="48">2D</text>
              <text x="120" y="150" class="svg-text-bold" fill="#F4F7FB">MẶT PHẲNG</text>
              <text x="120" y="190" class="svg-text-mono" fill="#A7F3D0">Giữ trọn 95% thông tin</text>
            </g>
          </g>
        """,
        "pill": '<span class="mono-accent">PRINCIPAL COMPONENT ANALYSIS</span>'
    }

    # b20 to b23: Reinforcement Learning
    scenes["b20"] = {
        "eyebrow": "TRỤ CỘT THỨ BA",
        "title": "HỌC TĂNG CƯỜNG (REINFORCEMENT)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#2A0E05" stroke="#F97316" stroke-width="4" />
          <g transform="translate(100, 80)">
            <rect x="40" y="40" width="640" height="400" rx="20" fill="#1E1E2E" stroke="#EA580C" stroke-width="3" />
            <g transform="translate(80, 80)">
              <rect width="80" height="80" rx="16" fill="#38BDF8" />
              <text x="40" y="45" class="svg-text-bold" fill="#0F172A" font-size="28">ROBOT</text>
            </g>
            <g transform="translate(480, 260)">
              <rect width="80" height="80" rx="16" fill="#34D399" />
              <text x="40" y="45" class="svg-text-bold" fill="#064E3B" font-size="28">ĐÍCH</text>
            </g>
            <g transform="translate(280, 160)">
              <rect width="80" height="80" rx="16" fill="#EF4444" />
              <text x="40" y="45" class="svg-text-bold" fill="#FEE2E2" font-size="28">BẪY</text>
            </g>
          </g>
        """,
        "badge": "TÁC TỬ TƯƠNG TÁC ĐẤU TRƯỜNG ẢO"
    }

    scenes["b21"] = {
        "eyebrow": "VÒNG LẶP HỌC TẬP",
        "title": "CHU TRÌNH AGENT &amp; ENVIRONMENT",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#F97316" stroke-width="4" />
          <g transform="translate(120, 100)">
            <rect x="40" y="40" width="220" height="120" rx="16" fill="#C2410C" />
            <text x="150" y="90" class="svg-text-bold" fill="#FFF7ED" font-size="26">AGENT (ROBOT)</text>
            <path d="M 280 80 L 460 80" stroke="#F97316" stroke-width="6" />
            <text x="370" y="60" class="svg-text-mono" fill="#FDBA74" font-size="20">Action (Hành động)</text>
            <rect x="480" y="40" width="220" height="120" rx="16" fill="#0369A1" />
            <text x="590" y="90" class="svg-text-bold" fill="#F0F9FF" font-size="24">MÔI TRƯỜNG</text>
            <path d="M 480 130 L 280 130" stroke="#34D399" stroke-width="6" />
            <text x="370" y="165" class="svg-text-mono" fill="#86EFAC" font-size="20">Reward &amp; State mới</text>
          </g>
        """,
        "pill": '<span class="text-sub">CƠ CHẾ:</span> <span class="mono-accent">THỬ VÀ SAI LIÊN TỤC (TRIAL &amp; ERROR)</span>'
    }

    scenes["b22"] = {
        "eyebrow": "ĐIỀU HƯỚNG MỤC TIÊU",
        "title": "CƠ CHẾ PHẦN THƯỞNG (REWARD)",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="180" y="80" class="svg-text-bold" fill="#34D399" font-size="64">+100</text>
            <text x="180" y="140" class="svg-text-bold" fill="#F0FDF4" font-size="32">THƯỞNG LỚN</text>
            <text x="180" y="240" class="svg-text-mono" fill="#A7F3D0">&bull; Đến đích an toàn</text>
            <text x="180" y="290" class="svg-text-mono" fill="#A7F3D0">&bull; Ăn điểm mục tiêu</text>
            <text x="180" y="340" class="svg-text-mono" fill="#A7F3D0">&bull; Tiết kiệm năng lượng</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#7F1D1D" stroke="#EF4444" stroke-width="4" />
            <text x="180" y="80" class="svg-text-bold" fill="#EF4444" font-size="64">-50</text>
            <text x="180" y="140" class="svg-text-bold" fill="#FEF2F2" font-size="32">TRỪ PHẠT</text>
            <text x="180" y="240" class="svg-text-mono" fill="#FCA5A5">&bull; Đâm vào tường</text>
            <text x="180" y="290" class="svg-text-mono" fill="#FCA5A5">&bull; Rơi xuống hố</text>
            <text x="180" y="340" class="svg-text-mono" fill="#FCA5A5">&bull; Đi sai hướng</text>
          </g>
        """,
        "badge": "MỤC TIÊU: TỐI ĐA HÓA TỔNG PHẦN THƯỞNG"
    }

    scenes["b23"] = {
        "eyebrow": "KỶ LỤC LỊCH SỬ",
        "title": "CHIẾN THẮNG ALPHAGO",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(100, 80)">
            <rect x="60" y="40" width="600" height="240" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="300" y="70" class="svg-text-mono" fill="#8B94A6">TỶ LỆ THẮNG TỰ ĐẤU HÀNG TRIỆU VÁN</text>
            <text x="300" y="150" class="svg-text-bold" fill="#34D399" font-size="88">99.9%</text>
          </g>
          <text x="460" y="440" class="svg-text-bold" fill="#F4F7FB" font-size="32">ĐÁNH BẠI ĐẠI KIỆN TƯỚNG CỜ VÂY</text>
          <text x="460" y="490" class="svg-text-mono" fill="#60A5FA" font-size="24">TỰ ĐỘNG HỌC ĐI THĂNG BẰNG TRÊN MỌI ĐỊA HÌNH</text>
        """,
        "badge": "ĐỈNH CAO HỌC TĂNG CƯỜNG HIỆN ĐẠI"
    }

    # b24 to b28: Deep Learning
    scenes["b24"] = {
        "is_quote": True,
        "tag": "BƯỚC NGOẶT THỜI ĐẠI",
        "text": "&ldquo;Mạng nơ-ron nhân tạo lấy cảm hứng từ cấu trúc mạng lưới hàng tỷ tế bào nơ-ron trong bộ não sinh học con người.&rdquo;",
        "author": "&mdash; NỀN TẢNG KỶ NGUYÊN DEEP LEARNING",
        "svg": """
          <g transform="translate(160, 40)">
            <rect width="600" height="300" rx="24" fill="#0F172A" stroke="#F43F5E" stroke-width="4" />
            <circle cx="150" cy="150" r="30" fill="#F43F5E" />
            <circle cx="300" cy="90" r="30" fill="#FB7185" />
            <circle cx="300" cy="210" r="30" fill="#FB7185" />
            <circle cx="450" cy="150" r="30" fill="#FDA4AF" />
            <line x1="150" y1="150" x2="300" y2="90" stroke="#F43F5E" stroke-width="4" />
            <line x1="150" y1="150" x2="300" y2="210" stroke="#F43F5E" stroke-width="4" />
            <line x1="300" y1="90" x2="450" y2="150" stroke="#FB7185" stroke-width="4" />
            <line x1="300" y1="210" x2="450" y2="150" stroke="#FB7185" stroke-width="4" />
          </g>
        """,
        "badge": "MẠNG NƠ-RON NHÂN TẠO ĐA TẦNG"
    }

    scenes["b25"] = {
        "eyebrow": "PHÂN CẤP KHÁI NIỆM",
        "title": "TẬP HỢP LỒNG NHAU CỦA AI",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(460, 320)">
            <circle cx="0" cy="0" r="240" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
            <text x="0" y="-190" class="svg-text-bold" fill="#60A5FA" font-size="30">TRÍ TUỆ NHÂN TẠO (AI)</text>
            <circle cx="0" cy="30" r="160" fill="#0F2942" stroke="#38BDF8" stroke-width="4" />
            <text x="0" y="-80" class="svg-text-bold" fill="#38BDF8" font-size="26">MACHINE LEARNING</text>
            <circle cx="0" cy="60" r="90" fill="#881337" stroke="#F43F5E" stroke-width="4" />
            <text x="0" y="65" class="svg-text-bold" fill="#FFF1F2" font-size="22">DEEP LEARNING</text>
          </g>
        """,
        "badge": "DEEP LEARNING LÀ TẬP CON CỦA ML"
    }

    scenes["b26"] = {
        "eyebrow": "CẤU TRÚC VI MÔ",
        "title": "GIẢI PHẪU MỘT NƠ-RON NHÂN TẠO",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#F43F5E" stroke-width="4" />
          <g transform="translate(100, 80)">
            <g transform="translate(40, 60)">
              <circle cx="40" cy="40" r="30" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
              <text x="40" y="45" class="svg-text-mono" fill="#60A5FA" font-size="24">x1</text>
              <circle cx="40" cy="160" r="30" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
              <text x="40" y="165" class="svg-text-mono" fill="#60A5FA" font-size="24">x2</text>
              <circle cx="40" cy="280" r="30" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
              <text x="40" y="285" class="svg-text-mono" fill="#60A5FA" font-size="24">x3</text>
            </g>
            <g transform="translate(320, 140)">
              <circle cx="80" cy="80" r="70" fill="#881337" stroke="#F43F5E" stroke-width="4" />
              <text x="80" y="65" class="svg-text-bold" fill="#FFF1F2" font-size="28">&sum; w&middot;x + b</text>
              <text x="80" y="105" class="svg-text-mono" fill="#FDA4AF" font-size="20">Hàm ReLU</text>
            </g>
            <g transform="translate(580, 190)">
              <circle cx="40" cy="30" r="30" fill="#064E3B" stroke="#34D399" stroke-width="3" />
              <text x="40" y="35" class="svg-text-bold" fill="#A7F3D0" font-size="24">Output</text>
            </g>
          </g>
        """,
        "pill": '<span class="mono-accent">CÔNG THỨC:</span> <span class="text-sub">f(&sum; w_i &middot; x_i + b)</span>'
    }

    scenes["b27"] = {
        "eyebrow": "HỌC BIỂU DIỄN ĐẶC TRƯNG",
        "title": "3 TẦNG TRỪU TƯỢNG HÓA",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="240" height="480" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="120" y="60" class="svg-text-bold" fill="#60A5FA" font-size="24">TẦNG 1: THÔ</text>
            <line x1="30" y1="90" x2="210" y2="90" stroke="#334155" stroke-width="2" />
            <text x="120" y="160" class="svg-text-mono" fill="#F4F7FB">Cạnh viền</text>
            <text x="120" y="220" class="svg-text-mono" fill="#F4F7FB">Đường nét</text>
            <text x="120" y="280" class="svg-text-mono" fill="#F4F7FB">Góc cạnh</text>
          </g>
          <g transform="translate(340, 80)">
            <rect width="240" height="480" rx="20" fill="#1E293B" stroke="#FBBF24" stroke-width="3" />
            <text x="120" y="60" class="svg-text-bold" fill="#FBBF24" font-size="24">TẦNG 2: GHÉP</text>
            <line x1="30" y1="90" x2="210" y2="90" stroke="#334155" stroke-width="2" />
            <text x="120" y="160" class="svg-text-mono" fill="#F4F7FB">Mắt, Mũi</text>
            <text x="120" y="220" class="svg-text-mono" fill="#F4F7FB">Miệng, Cằm</text>
            <text x="120" y="280" class="svg-text-mono" fill="#F4F7FB">Họa tiết</text>
          </g>
          <g transform="translate(620, 80)">
            <rect width="240" height="480" rx="20" fill="#1E293B" stroke="#34D399" stroke-width="3" />
            <text x="120" y="60" class="svg-text-bold" fill="#34D399" font-size="24">TẦNG 3: TINH</text>
            <line x1="30" y1="90" x2="210" y2="90" stroke="#334155" stroke-width="2" />
            <text x="120" y="160" class="svg-text-mono" fill="#F4F7FB">Khuôn mặt</text>
            <text x="120" y="220" class="svg-text-mono" fill="#F4F7FB">Chân dung</text>
            <text x="120" y="280" class="svg-text-mono" fill="#F4F7FB">Nhận diện</text>
          </g>
        """,
        "badge": "TỰ ĐỘNG TRÍCH XUẤT ĐẶC TRƯNG TỪ SÂU"
    }

    scenes["b28"] = {
        "eyebrow": "CỘT MỐC IMAGENET 2012",
        "title": "BƯỚC NGOẶT ALEXNET",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#F43F5E" stroke-width="4" />
          <g transform="translate(100, 80)">
            <g transform="translate(40, 80)">
              <rect width="240" height="240" rx="20" fill="#1E1E2E" stroke="#EF4444" stroke-width="3" />
              <text x="120" y="80" class="svg-text-mono" fill="#8B94A6">TRUYỀN THỐNG</text>
              <text x="120" y="150" class="svg-text-bold" fill="#EF4444" font-size="64">26.2%</text>
              <text x="120" y="195" class="svg-text-mono" fill="#F87171">Tỷ lệ lỗi Top-5</text>
            </g>
            <g transform="translate(440, 80)">
              <rect width="240" height="240" rx="20" fill="#064E3B" stroke="#34D399" stroke-width="4" />
              <text x="120" y="80" class="svg-text-mono" fill="#A7F3D0">ALEXNET 2012</text>
              <text x="120" y="150" class="svg-text-bold" fill="#34D399" font-size="64">15.3%</text>
              <text x="120" y="195" class="svg-text-bold" fill="#34D399">GIẢM ĐỘT PHÁ &checkmark;</text>
            </g>
          </g>
        """,
        "badge": "MỞ RA KỶ NGUYÊN BÙNG NỔ DEEP LEARNING"
    }

    # b29 to b35: Loss & Optimization Engine
    scenes["b29"] = {
        "eyebrow": "HẬU TRƯỜNG TOÁN HỌC",
        "title": "CƠ CHẾ TIẾN BỘ CỦA MÁY TÍNH",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#FBBF24" stroke-width="4" />
          <g transform="translate(140, 120)">
            <circle cx="160" cy="160" r="120" fill="#78350F" stroke="#F59E0B" stroke-width="4" />
            <text x="160" y="145" class="svg-text-bold" fill="#FDE68A" font-size="28">LOSS</text>
            <text x="160" y="185" class="svg-text-bold" fill="#FDE68A" font-size="28">FUNCTION</text>
            <circle cx="420" cy="240" r="100" fill="#1E3A8A" stroke="#60A5FA" stroke-width="4" />
            <text x="420" y="225" class="svg-text-bold" fill="#BFDBFE" font-size="24">GRADIENT</text>
            <text x="420" y="265" class="svg-text-bold" fill="#BFDBFE" font-size="24">DESCENT</text>
          </g>
        """,
        "badge": "HAI BÁNH RĂNG VẬN HÀNH QUÁ TRÌNH HỌC"
    }

    scenes["b30"] = {
        "is_quote": True,
        "tag": "HAI THÀNH TỐ CỐT TỬ",
        "text": "&ldquo;Mô hình học máy tiến bộ nhờ hai bước: đo lường sai số qua hàm Loss, và lùi dốc tìm cực tiểu qua Gradient Descent.&rdquo;",
        "author": "&mdash; TRÁI TIM CỦA MỌI THUẬT TOÁN TỐI ƯU HÓA",
        "svg": """
          <g transform="translate(160, 40)">
            <rect width="600" height="300" rx="24" fill="#0F172A" stroke="#FBBF24" stroke-width="4" />
            <text x="300" y="110" class="svg-text-bold" fill="#FDE68A" font-size="44">L(y, &#375;) &amp; &nabla;L</text>
            <text x="300" y="190" class="svg-text-mono" fill="#F4F7FB" font-size="28">ĐO SAI SỐ &amp; TÍNH ĐẠO HÀM DỐC</text>
          </g>
        """,
        "badge": "NGUYÊN LÝ HỌC TẬP TỰ ĐỘNG"
    }

    scenes["b31"] = {
        "eyebrow": "ĐO LƯỜNG SAI SỐ",
        "title": "HÀM MẤT MÁT (LOSS FUNCTION)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#EF4444" stroke-width="4" />
          <g transform="translate(100, 80)">
            <rect x="40" y="40" width="640" height="120" rx="16" fill="#1E293B" stroke="#EF4444" stroke-width="3" />
            <text x="320" y="85" class="svg-text-bold" fill="#F87171" font-size="32">MSE = &frac1N; &sum; (y_thật - y_đoán)&sup2;</text>
          </g>
          <text x="460" y="340" class="svg-text-bold" fill="#F4F7FB" font-size="30">KHOẢNG CÁCH CÀNG LỚN &rarr; PHẠT CÀNG NẶNG</text>
        """,
        "pill": '<span class="mono-accent">MEAN SQUARED ERROR &amp; CROSS-ENTROPY</span>'
    }

    scenes["b32"] = {
        "eyebrow": "MỤC TIÊU SỐNG CÒN",
        "title": "TRIỆT TIÊU SAI SỐ LOSS VỀ 0",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#34D399" stroke-width="4" />
          <g transform="translate(120, 100)">
            <g transform="translate(40, 40)">
              <rect width="120" height="300" rx="16" fill="#1E1E2E" stroke="#EF4444" stroke-width="3" />
              <rect x="10" y="50" width="100" height="240" rx="10" fill="#EF4444" />
              <text x="60" y="30" class="svg-text-mono" fill="#EF4444">Epoch 1</text>
              <text x="60" y="150" class="svg-text-bold" fill="#FFF">8.45</text>
            </g>
            <g transform="translate(240, 40)">
              <rect width="120" height="300" rx="16" fill="#1E1E2E" stroke="#F59E0B" stroke-width="3" />
              <rect x="10" y="150" width="100" height="140" rx="10" fill="#F59E0B" />
              <text x="60" y="30" class="svg-text-mono" fill="#F59E0B">Epoch 50</text>
              <text x="60" y="210" class="svg-text-bold" fill="#FFF">1.20</text>
            </g>
            <g transform="translate(440, 40)">
              <rect width="120" height="300" rx="16" fill="#1E1E2E" stroke="#34D399" stroke-width="3" />
              <rect x="10" y="260" width="100" height="30" rx="10" fill="#34D399" />
              <text x="60" y="30" class="svg-text-mono" fill="#34D399">Epoch 200</text>
              <text x="60" y="240" class="svg-text-bold" fill="#34D399">0.02</text>
            </g>
          </g>
        """,
        "badge": "TỐI THIỂU HÓA HÀM MẤT MÁT"
    }

    scenes["b33"] = {
        "eyebrow": "THUẬT TOÁN TỐI ƯU",
        "title": "GRADIENT DESCENT (LÙI DỐC)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(100, 80)">
            <path d="M 80 100 Q 360 420 640 100" fill="none" stroke="#60A5FA" stroke-width="6" />
            <circle cx="160" cy="180" r="24" fill="#F59E0B" stroke="#FDE68A" stroke-width="4" />
            <circle cx="360" cy="340" r="16" fill="#34D399" />
            <text x="360" y="390" class="svg-text-bold" fill="#34D399" font-size="24">ĐÁY CỰC TIỂU (MINIMUM)</text>
          </g>
        """,
        "pill": '<span class="mono-accent">CÔNG THỨC:</span> <span class="text-sub">W = W - &alpha; &middot; &nabla;L</span>'
    }

    scenes["b34"] = {
        "eyebrow": "THAM SỐ QUYẾT ĐỊNH",
        "title": "TỐC ĐỘ HỌC (LEARNING RATE &alpha;)",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#1E1E2E" stroke="#EF4444" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#EF4444">BƯỚC QUÁ LỚN (&alpha; = 1.0)</text>
            <path d="M 40 120 Q 180 340 320 120" fill="none" stroke="#EF4444" stroke-width="4" />
            <line x1="60" y1="140" x2="300" y2="140" stroke="#FCA5A5" stroke-width="4" stroke-dasharray="6 6" />
            <text x="180" y="400" class="svg-text-bold" fill="#EF4444" font-size="26">&cross; VĂNG RA NGOÀI</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#34D399">BƯỚC CHUẨN (&alpha; = 0.001)</text>
            <path d="M 40 120 Q 180 340 320 120" fill="none" stroke="#34D399" stroke-width="4" />
            <circle cx="180" cy="285" r="16" fill="#34D399" />
            <text x="180" y="400" class="svg-text-bold" fill="#34D399" font-size="26">&checkmark; HỘI TỤ CHÍNH XÁC</text>
          </g>
        """,
        "badge": "CHÌA KHÓA HỘI TỤ MÔ HÌNH"
    }

    scenes["b35"] = {
        "eyebrow": "CƠ CHẾ TINH CHỈNH",
        "title": "LAN TRUYỀN NGƯỢC (BACKPROPAGATION)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#EF4444" stroke-width="4" />
          <g transform="translate(100, 100)">
            <circle cx="100" cy="180" r="40" fill="#1E3A8A" stroke="#60A5FA" stroke-width="3" />
            <text x="100" y="185" class="svg-text-bold" fill="#FFF">Input</text>
            <circle cx="360" cy="180" r="40" fill="#581C87" stroke="#C084FC" stroke-width="3" />
            <text x="360" y="185" class="svg-text-bold" fill="#FFF">Hidden</text>
            <circle cx="620" cy="180" r="40" fill="#881337" stroke="#FB7185" stroke-width="3" />
            <text x="620" y="185" class="svg-text-bold" fill="#FFF">Output</text>
            <path d="M 560 140 L 420 140" stroke="#EF4444" stroke-width="8" />
            <text x="490" y="110" class="svg-text-bold" fill="#EF4444" font-size="24">&part;L / &part;W2</text>
            <path d="M 300 140 L 160 140" stroke="#EF4444" stroke-width="8" />
            <text x="230" y="110" class="svg-text-bold" fill="#EF4444" font-size="24">&part;L / &part;W1</text>
          </g>
          <text x="460" y="480" class="svg-text-bold" fill="#F4F7FB" font-size="28">TRUYỀN SAI SỐ NGƯỢC ĐỂ CHỈNH MỌI TRỌNG SỐ</text>
        """,
        "badge": "PHÁT MINH ĐƯA DEEP LEARNING THÀNH HIỆN THỰC (1986)"
    }

    # b36 to b42: Overfitting vs Underfitting
    scenes["b36"] = {
        "eyebrow": "CẠM BẪY LỚN NHẤT",
        "title": "CUỘC CHIẾN 3 TRẠNG THÁI",
        "svg": """
          <g transform="translate(40, 80)">
            <rect width="260" height="480" rx="20" fill="#1E1E2E" stroke="#EF4444" stroke-width="3" />
            <text x="130" y="60" class="svg-text-bold" fill="#EF4444" font-size="24">UNDERFITTING</text>
            <path d="M 40 380 L 220 160" stroke="#EF4444" stroke-width="5" />
            <text x="130" y="440" class="svg-text-mono" fill="#F87171">Quá đơn giản</text>
          </g>
          <g transform="translate(330, 80)">
            <rect width="260" height="480" rx="20" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="130" y="60" class="svg-text-bold" fill="#34D399" font-size="24">GOOD FIT</text>
            <path d="M 40 360 Q 130 180 220 200" stroke="#34D399" stroke-width="6" fill="none" />
            <text x="130" y="440" class="svg-text-bold" fill="#34D399">&checkmark; Vừa vặn tối ưu</text>
          </g>
          <g transform="translate(620, 80)">
            <rect width="260" height="480" rx="20" fill="#1E1E2E" stroke="#F59E0B" stroke-width="3" />
            <text x="130" y="60" class="svg-text-bold" fill="#F59E0B" font-size="24">OVERFITTING</text>
            <path d="M 40 360 Q 80 140 120 300 T 220 180" stroke="#F59E0B" stroke-width="5" fill="none" />
            <text x="130" y="440" class="svg-text-mono" fill="#FCD34D">Học vẹt dữ liệu</text>
          </g>
        """,
        "badge": "RANH GIỚI VÀNG CỦA MÔ HÌNH HỌC MÁY"
    }

    scenes["b37"] = {
        "eyebrow": "TRẠNG THÁI THỨ NHẤT",
        "title": "UNDERFITTING (CHƯA KHỚP)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#EF4444" stroke-width="4" />
          <g transform="translate(100, 80)">
            <text x="360" y="60" class="svg-text-bold" fill="#EF4444" font-size="34">HIGH BIAS (ĐỘ LỆCH CAO)</text>
            <circle cx="160" cy="180" r="14" fill="#38BDF8" />
            <circle cx="280" cy="320" r="14" fill="#38BDF8" />
            <circle cx="440" cy="200" r="14" fill="#38BDF8" />
            <circle cx="560" cy="340" r="14" fill="#38BDF8" />
            <line x1="80" y1="260" x2="640" y2="260" stroke="#EF4444" stroke-width="6" />
            <rect x="140" y="380" width="440" height="60" rx="12" fill="#7F1D1D" />
            <text x="360" y="415" class="svg-text-bold" fill="#FCA5A5" font-size="24">KHÔNG HỌC NỔI QUY LUẬT CƠ BẢN</text>
          </g>
        """,
        "pill": '<span class="text-sub">KHẮC PHỤC:</span> <span class="mono-accent">TĂNG ĐỘ PHỨC TẠP MÔ HÌNH</span>'
    }

    scenes["b38"] = {
        "eyebrow": "CẠM BẪY NGUY HIỂM",
        "title": "OVERFITTING (HỌC VẸT)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#F59E0B" stroke-width="4" />
          <g transform="translate(100, 80)">
            <text x="360" y="60" class="svg-text-bold" fill="#F59E0B" font-size="34">HIGH VARIANCE (PHƯƠNG SAI CAO)</text>
            <circle cx="140" cy="240" r="14" fill="#38BDF8" />
            <circle cx="260" cy="140" r="14" fill="#EF4444" />
            <circle cx="380" cy="320" r="14" fill="#38BDF8" />
            <circle cx="500" cy="180" r="14" fill="#EF4444" />
            <path d="M 80 300 Q 140 240 200 120 T 320 340 T 440 140 T 560 300" fill="none" stroke="#F59E0B" stroke-width="6" />
            <rect x="140" y="380" width="440" height="60" rx="12" fill="#78350F" />
            <text x="360" y="415" class="svg-text-bold" fill="#FDE68A" font-size="24">GHI NHỚ CẢ NHỮNG ĐIỂM NHIỄU RÁC</text>
          </g>
        """,
        "badge": "MÔ HÌNH QUÁ PHỨC TẠP"
    }

    scenes["b39"] = {
        "eyebrow": "HỆ QUẢ THỰC TẾ",
        "title": "SỤP ĐỔ KHI THI THẬT",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#34D399">BÀI THI THỬ (TRAIN)</text>
            <text x="180" y="180" class="svg-text-bold" fill="#34D399" font-size="88">99%</text>
            <text x="180" y="280" class="svg-text-bold" fill="#F0FDF4" font-size="28">HOÀN HẢO</text>
            <text x="180" y="340" class="svg-text-mono" fill="#A7F3D0">Đã học thuộc lòng</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#7F1D1D" stroke="#EF4444" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#EF4444">BÀI THI THẬT (TEST)</text>
            <text x="180" y="180" class="svg-text-bold" fill="#EF4444" font-size="88">42%</text>
            <text x="180" y="280" class="svg-text-bold" fill="#FEF2F2" font-size="28">SỤP ĐỔ</text>
            <text x="180" y="340" class="svg-text-mono" fill="#FCA5A5">Bất lực với dữ liệu mới</text>
          </g>
        """,
        "badge": "MÔ HÌNH HỌC VẸT KHÔNG THỂ KHÁI QUÁT HÓA"
    }

    scenes["b40"] = {
        "eyebrow": "GIẢI PHÁP CHUẨN HÓA",
        "title": "CHIA 3 TẬP DỮ LIỆU ĐỘC LẬP",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(100, 120)">
            <rect width="420" height="180" rx="16" fill="#0284C7" />
            <text x="210" y="70" class="svg-text-bold" fill="#FFF" font-size="36">TRAIN 70%</text>
            <text x="210" y="120" class="svg-text-mono" fill="#BAE6FD">Huấn luyện trọng số</text>
            <g transform="translate(440, 0)">
              <rect width="180" height="85" rx="12" fill="#D97706" />
              <text x="90" y="35" class="svg-text-bold" fill="#FFF" font-size="20">VAL 15%</text>
              <text x="90" y="60" class="svg-text-mono" fill="#FEF3C7" font-size="14">Chỉnh tham số</text>
            </g>
            <g transform="translate(440, 95)">
              <rect width="180" height="85" rx="12" fill="#7E22CE" />
              <text x="90" y="35" class="svg-text-bold" fill="#FFF" font-size="20">TEST 15%</text>
              <text x="90" y="60" class="svg-text-mono" fill="#F3E8FF" font-size="14">Thi thật khách quan</text>
            </g>
          </g>
        """,
        "pill": '<span class="mono-accent">QUY TẮC:</span> <span class="text-sub">TẬP TEST PHẢI HOÀN TOÀN BÍ MẬT</span>'
    }

    scenes["b41"] = {
        "eyebrow": "KỸ THUẬT PHÒNG THỦ",
        "title": "REGULARIZATION &amp; DROPOUT",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="180" y="60" class="svg-text-bold" fill="#60A5FA">REGULARIZATION</text>
            <text x="180" y="100" class="svg-text-mono" fill="#8B94A6">Điều chuẩn L1 / L2</text>
            <line x1="40" y1="130" x2="320" y2="130" stroke="#334155" stroke-width="2" />
            <text x="180" y="200" class="svg-text-bold" fill="#F4F7FB">Phạt trọng số quá lớn</text>
            <text x="180" y="250" class="svg-text-mono" fill="#94A3B8">Giữ mô hình luôn mượt</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#1E293B" stroke="#F43F5E" stroke-width="3" />
            <text x="180" y="60" class="svg-text-bold" fill="#F43F5E">DROPOUT</text>
            <text x="180" y="100" class="svg-text-mono" fill="#8B94A6">Ngắt nơ-ron ngẫu nhiên</text>
            <line x1="40" y1="130" x2="320" y2="130" stroke="#334155" stroke-width="2" />
            <text x="180" y="200" class="svg-text-bold" fill="#F4F7FB">Tắt 50% nốt mỗi lượt</text>
            <text x="180" y="250" class="svg-text-mono" fill="#94A3B8">Ép học đặc trưng bền vững</text>
          </g>
        """,
        "badge": "BẢO VỆ MÔ HÌNH KHỎI HỌC VẸT"
    }

    scenes["b42"] = {
        "is_quote": True,
        "tag": "THƯỚC ĐO DANH GIÁ",
        "text": "&ldquo;Khả năng tổng quát hóa (Generalization) trên dữ liệu chưa từng thấy mới là minh chứng duy nhất cho một AI thành công.&rdquo;",
        "author": "&mdash; NGUYÊN TẮC VÀNG CỦA MACHINE LEARNING",
        "svg": """
          <g transform="translate(160, 40)">
            <rect width="600" height="300" rx="24" fill="#0F172A" stroke="#FBBF24" stroke-width="4" />
            <circle cx="300" cy="150" r="80" fill="#78350F" stroke="#F59E0B" stroke-width="4" />
            <text x="300" y="140" class="svg-text-bold" fill="#FDE68A" font-size="32">&starf; &starf; &starf;</text>
            <text x="300" y="180" class="svg-text-mono" fill="#FDE68A" font-size="20">GENERALIZATION</text>
          </g>
        """,
        "badge": "CHỨNG NHẬN MÔ HÌNH THỰC CHIẾN"
    }

    # b43 to b48: Data & Production Realities
    scenes["b43"] = {
        "eyebrow": "SỰ THẬT SẢN XUẤT",
        "title": "DỮ LIỆU LÀ VUA (DATA IS KING)",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#FBBF24" stroke-width="4" />
          <g transform="translate(460, 240)">
            <path d="M -120 60 L -60 -40 L 0 20 L 60 -40 L 120 60 Z" fill="#F59E0B" stroke="#FDE68A" stroke-width="4" />
            <text x="0" y="130" class="svg-text-bold" fill="#FDE68A" font-size="44">DATA IS KING</text>
          </g>
          <g transform="translate(160, 420)">
            <rect width="600" height="100" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="300" y="55" class="svg-text-bold" fill="#F4F7FB" font-size="28">THUẬT TOÁN TỐT CẦN DỮ LIỆU SẠCH</text>
          </g>
        """,
        "badge": "DATA-CENTRIC AI NÂNG CAO CHẤT LƯỢNG"
    }

    scenes["b44"] = {
        "eyebrow": "KHẢO SÁT CÔNG SỨC",
        "title": "TIỀN XỬ LÝ &amp; FEATURE ENGINEERING",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(100, 80)">
            <rect x="40" y="40" width="640" height="140" rx="16" fill="#0284C7" />
            <text x="320" y="65" class="svg-text-bold" fill="#FFF" font-size="48">80% THỜI GIAN</text>
            <text x="320" y="110" class="svg-text-mono" fill="#BAE6FD">Thu thập &bull; Làm sạch &bull; Lọc rác &bull; Tạo đặc trưng</text>
            <rect x="40" y="220" width="640" height="100" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="2" />
            <text x="320" y="260" class="svg-text-bold" fill="#34D399" font-size="28">20% THỜI GIAN</text>
            <text x="320" y="295" class="svg-text-mono" fill="#8B94A6">Chạy mô hình &amp; Tinh chỉnh Hyperparameters</text>
          </g>
        """,
        "pill": '<span class="mono-accent">NGUỒN:</span> <span class="text-sub">FORBES &amp; CROWDFLOWER DATA SCIENCE SURVEY</span>'
    }

    scenes["b45"] = {
        "eyebrow": "ĐỊNH LUẬT BẤT BIẾN",
        "title": "GARBAGE IN &rarr; GARBAGE OUT",
        "svg": """
          <g transform="translate(60, 80)">
            <rect width="360" height="480" rx="24" fill="#7F1D1D" stroke="#EF4444" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#EF4444">GARBAGE IN</text>
            <text x="180" y="140" class="svg-text-mono" fill="#FCA5A5">Dữ liệu rác bẩn</text>
            <text x="180" y="180" class="svg-text-mono" fill="#FCA5A5">Thiếu nhãn, sai số</text>
            <text x="180" y="220" class="svg-text-mono" fill="#FCA5A5">Thiên vị mẫu</text>
          </g>
          <g transform="translate(500, 80)">
            <rect width="360" height="480" rx="24" fill="#7F1D1D" stroke="#EF4444" stroke-width="4" />
            <text x="180" y="60" class="svg-text-bold" fill="#EF4444">GARBAGE OUT</text>
            <text x="180" y="140" class="svg-text-mono" fill="#FCA5A5">Dự đoán sai lầm</text>
            <text x="180" y="180" class="svg-text-mono" fill="#FCA5A5">Hệ thống đổ vỡ</text>
            <text x="180" y="220" class="svg-text-mono" fill="#FCA5A5">Thiệt hại kinh tế</text>
          </g>
        """,
        "badge": "CHẤT LƯỢNG DATA QUYẾT ĐỊNH TẤT CẢ"
    }

    scenes["b46"] = {
        "eyebrow": "QUY TRÌNH THỰC CHIẾN",
        "title": "VÒNG LẶP MLOPS 5 BƯỚC",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#34D399" stroke-width="4" />
          <g transform="translate(100, 80)">
            <g transform="translate(0, 40)"><rect width="640" height="60" rx="12" fill="#1E293B" /><text x="320" y="35" class="svg-text-bold" fill="#38BDF8">1. THU THẬP &amp; LÀM SẠCH DATA</text></g>
            <g transform="translate(0, 115)"><rect width="640" height="60" rx="12" fill="#1E293B" /><text x="320" y="35" class="svg-text-bold" fill="#60A5FA">2. CHỌN THUẬT TOÁN &amp; TRAIN</text></g>
            <g transform="translate(0, 190)"><rect width="640" height="60" rx="12" fill="#1E293B" /><text x="320" y="35" class="svg-text-bold" fill="#FBBF24">3. ĐÁNH GIÁ TRÊN TẬP TEST</text></g>
            <g transform="translate(0, 265)"><rect width="640" height="60" rx="12" fill="#1E293B" /><text x="320" y="35" class="svg-text-bold" fill="#A855F7">4. TRIỂN KHAI PRODUCTION</text></g>
            <g transform="translate(0, 340)"><rect width="640" height="60" rx="12" fill="#1E293B" /><text x="320" y="35" class="svg-text-bold" fill="#34D399">5. GIÁM SÁT LIÊN TỤC &amp; RETRAIN</text></g>
          </g>
        """,
        "badge": "VÒNG ĐỜI DỰ ÁN HỌC MÁY CHUYÊN NGHIỆP"
    }

    scenes["b47"] = {
        "eyebrow": "NỀN TẢNG KHOA HỌC",
        "title": "3 TRỤ CỘT NÂNG ĐỠ CỖ MÁY",
        "svg": """
          <g transform="translate(40, 80)">
            <rect width="260" height="480" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="130" y="60" class="svg-text-bold" fill="#60A5FA">1. ĐẠI SỐ</text>
            <text x="130" y="100" class="svg-text-mono" fill="#8B94A6">Tuyến tính</text>
            <text x="130" y="200" class="svg-text-mono" fill="#F4F7FB">Ma trận, Vector</text>
          </g>
          <g transform="translate(330, 80)">
            <rect width="260" height="480" rx="20" fill="#1E293B" stroke="#FBBF24" stroke-width="3" />
            <text x="130" y="60" class="svg-text-bold" fill="#FBBF24">2. XÁC SUẤT</text>
            <text x="130" y="100" class="svg-text-mono" fill="#8B94A6">Thống kê</text>
            <text x="130" y="200" class="svg-text-mono" fill="#F4F7FB">Phân phối, Bayes</text>
          </g>
          <g transform="translate(620, 80)">
            <rect width="260" height="480" rx="20" fill="#1E293B" stroke="#34D399" stroke-width="3" />
            <text x="130" y="60" class="svg-text-bold" fill="#34D399">3. TÍNH TOÁN</text>
            <text x="130" y="100" class="svg-text-mono" fill="#8B94A6">Phần cứng</text>
            <text x="130" y="200" class="svg-text-mono" fill="#F4F7FB">GPU, Song song</text>
          </g>
        """,
        "badge": "SỰ GIAO THOA CỦA KHOA HỌC HIỆN ĐẠI"
    }

    scenes["b48"] = {
        "is_quote": True,
        "tag": "SỨC MẠNH BIẾN ĐỔI",
        "text": "&ldquo;Machine Learning biến những kho dữ liệu khổng lồ vô tri thành những dự đoán đắt giá, tái định hình mọi ngành công nghiệp.&rdquo;",
        "author": "&mdash; Y TẾ, TÀI CHÍNH, GIAO THÔNG, TỰ ĐỘNG HÓA",
        "svg": """
          <g transform="translate(160, 40)">
            <rect width="600" height="300" rx="24" fill="#0F172A" stroke="#38BDF8" stroke-width="4" />
            <text x="300" y="110" class="svg-text-bold" fill="#38BDF8" font-size="36">TỐI ƯU HÓA CUỘC SỐNG</text>
            <text x="300" y="180" class="svg-text-mono" fill="#F4F7FB" font-size="26">CHẨN ĐOÁN &bull; XE TỰ LÁI &bull; DỊCH THUẬT</text>
          </g>
        """,
        "badge": "ỨNG DỤNG THỰC TIỄN KHẮP THẾ GIỚI"
    }

    # b49 to b52: Closing & Roadmap
    scenes["b49"] = {
        "eyebrow": "LỘ TRÌNH CHINH PHỤC",
        "title": "3 CẤP ĐỘ NẮM VỮNG MACHINE LEARNING",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(100, 100)">
            <rect width="640" height="100" rx="16" fill="#0284C7" />
            <text x="320" y="55" class="svg-text-bold" fill="#FFF" font-size="28">BẬC 1: SUPERVISED (HỒI QUY &amp; PHÂN LOẠI)</text>
            <g transform="translate(0, 130)"><rect width="640" height="100" rx="16" fill="#7E22CE" /><text x="320" y="55" class="svg-text-bold" fill="#FFF" font-size="28">BẬC 2: UNSUPERVISED (GOM CỤM &amp; NÉN DỮ LIỆU)</text></g>
            <g transform="translate(0, 260)"><rect width="640" height="100" rx="16" fill="#881337" /><text x="320" y="55" class="svg-text-bold" fill="#FFF" font-size="28">BẬC 3: DEEP LEARNING (MẠNG NƠ-RON SÂU)</text></g>
          </g>
        """,
        "badge": "TIẾP CẬN TỪ BẢN CHẤT ĐẾN NÂNG CAO"
    }

    scenes["b50"] = {
        "eyebrow": "HÀNH TRÌNH CỦA BẠN",
        "title": "BẮT ĐẦU TỪ CON SỐ KHÔNG",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#34D399" stroke-width="4" />
          <g transform="translate(100, 80)">
            <g transform="translate(40, 80)">
              <rect width="240" height="240" rx="20" fill="#1E293B" stroke="#64748B" stroke-width="3" />
              <text x="120" y="80" class="svg-text-mono" fill="#8B94A6">KHỞI ĐẦU</text>
              <text x="120" y="150" class="svg-text-bold" fill="#94A3B8" font-size="64">DAY 0</text>
              <text x="120" y="195" class="svg-text-mono" fill="#8B94A6">Dòng dữ liệu đầu tiên</text>
            </g>
            <g transform="translate(440, 80)">
              <rect width="240" height="240" rx="20" fill="#064E3B" stroke="#34D399" stroke-width="4" />
              <text x="120" y="80" class="svg-text-mono" fill="#A7F3D0">THÀNH TỰU</text>
              <text x="120" y="150" class="svg-text-bold" fill="#34D399" font-size="64">MODEL 1</text>
              <text x="120" y="195" class="svg-text-bold" fill="#34D399">CHẠY THÀNH CÔNG &checkmark;</text>
            </g>
          </g>
        """,
        "badge": "BẮT ĐẦU DỰ ÁN ĐẦU TIÊN HÔM NAY"
    }

    scenes["b51"] = {
        "eyebrow": "HÀNH ĐỘNG NGAY",
        "title": "BẠN ĐÃ SẴN SÀNG?",
        "svg": """
          <rect x="60" y="40" width="800" height="560" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(180, 200)">
            <rect width="480" height="140" rx="24" fill="#0284C7" stroke="#38BDF8" stroke-width="4" />
            <text x="240" y="75" class="svg-text-bold" fill="#FFF" font-size="34">BẮT ĐẦU DỰ ÁN ML CỦA BẠN</text>
          </g>
          <text x="460" y="440" class="svg-text-bold" fill="#F4F7FB" font-size="30">CHỌN MỘT BÀI TOÁN THỰC TẾ &amp; XÂY DỰNG MÔ HÌNH</text>
        """,
        "badge": "CHUYỂN HÓA KIẾN THỨC THÀNH SẢN PHẨM"
    }

    scenes["b52"] = {
        "eyebrow": "TẤM BẢN ĐỒ TỔNG KẾT",
        "title": "4 ĐIỂM CHỐT TOÀN CẢNH MACHINE LEARNING",
        "svg": """
          <rect x="40" y="40" width="840" height="580" rx="28" fill="#0F172A" stroke="#60A5FA" stroke-width="4" />
          <g transform="translate(80, 80)">
            <g transform="translate(0, 20)"><rect width="680" height="85" rx="14" fill="#1E293B" stroke="#60A5FA" stroke-width="2" /><text x="340" y="48" class="svg-text-bold" fill="#60A5FA" font-size="24">1. ĐẢO CHIỀU TƯ DUY: DATA + OUTPUT &rarr; RULES</text></g>
            <g transform="translate(0, 125)"><rect width="680" height="85" rx="14" fill="#1E293B" stroke="#38BDF8" stroke-width="2" /><text x="340" y="48" class="svg-text-bold" fill="#38BDF8" font-size="24">2. 3 TRỤ CỘT: SUPERVISED &bull; UNSUPERVISED &bull; RL</text></g>
            <g transform="translate(0, 230)"><rect width="680" height="85" rx="14" fill="#1E293B" stroke="#FBBF24" stroke-width="2" /><text x="340" y="48" class="svg-text-bold" fill="#FBBF24" font-size="24">3. CỖ MÁY HỌC: LOSS FUNCTION &amp; GRADIENT DESCENT</text></g>
            <g transform="translate(0, 335)"><rect width="680" height="85" rx="14" fill="#1E293B" stroke="#34D399" stroke-width="2" /><text x="340" y="48" class="svg-text-bold" fill="#34D399" font-size="24">4. THỰC CHIẾN: DATA IS KING &amp; GENERALIZATION</text></g>
          </g>
        """,
        "badge": "LƯU LẠI BẢN ĐỒ KIẾN THỨC VÀ KHỞI HÀNH NGAY!"
    }

    return scenes

scenes_dict = get_scene_dict()

clips_html = []
for i, b in enumerate(beats):
    b_id = b["id"]
    start = b["start"]
    duration = b["duration"]
    data = scenes_dict[b_id]
    
    if data.get("is_quote"):
        inner_html = f"""
          <div class="quote-card" data-layout-allow-overlap style="top:240px; left:70px; right:70px;">
            <div class="quote-tag">{data['tag']}</div>
            <div class="quote-text">{data['text']}</div>
            <div class="quote-author"><span>{data['author']}</span></div>
          </div>
          <div class="diagram-box" data-layout-allow-overlap style="top:740px; height:460px;">
            <svg data-layout-allow-overlap viewBox="0 0 920 400" class="svg-canvas">
              {data['svg']}
            </svg>
          </div>
          {f'<div class="stamp-badge" data-layout-allow-overlap style="top:1250px;">{data["badge"]}</div>' if "badge" in data else ''}
        """
    else:
        badge_html = f'<div class="stamp-badge" data-layout-allow-overlap style="top:1250px;">{data["badge"]}</div>' if "badge" in data else ''
        pill_html = f'<div class="stat-pill" data-layout-allow-overlap style="top:1250px; left:80px; right:80px;">{data["pill"]}</div>' if "pill" in data else ''
        inner_html = f"""
          <div class="card-hero" data-layout-allow-overlap>
            <div class="eyebrow" data-layout-allow-overlap><span class="pulse-dot"></span> {data['eyebrow']}</div>
            <div class="title-display" data-layout-allow-overlap>{data['title']}</div>
          </div>
          <div class="diagram-box" data-layout-allow-overlap style="top:470px; height:740px;">
            <svg data-layout-allow-overlap viewBox="0 0 920 680" class="svg-canvas">
              {data['svg']}
            </svg>
          </div>
          {badge_html}
          {pill_html}
        """
        
    clip_str = f"""
    <section id="{b_id}" class="clip" data-start="{start:.2f}" data-duration="{duration:.2f}" data-track-index="1">
      <div class="scene-inner" style="position:absolute; inset:0;">
        {inner_html}
      </div>
    </section>
    """
    clips_html.append(clip_str)

all_clips_str = "\n".join(clips_html)

# Build GSAP transitions
gsap_transitions = []
for i, b in enumerate(beats):
    b_id = b["id"]
    start = b["start"]
    dur = b["duration"]
    
    if i > 0:
        gsap_transitions.append(f'tl.fromTo("#{b_id} .scene-inner", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, {start:.2f});')
    
    if i < len(beats) - 1:
        fade_out_time = start + dur - 0.28
        kill_time = start + dur
        gsap_transitions.append(f'tl.to("#{b_id} .scene-inner", {{ opacity: 0, duration: 0.28, ease: "none" }}, {fade_out_time:.2f});')
        gsap_transitions.append(f'tl.set("#{b_id} .scene-inner", {{ opacity: 0 }}, {kill_time:.2f});')

gsap_transitions_str = "\n    ".join(gsap_transitions)

full_html = f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Machine Learning Là Gì & Toàn Bộ Khái Niệm Quan Trọng (5 Phút)</title>
  <style>
    {inline_fonts_css}
    {css_styles}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="{total_duration:.2f}">
    <div class="bg-layer" style="position:absolute; inset:0; background-color:#0B0E14; z-index:0;"></div>
    
    <!-- === 52 SCENE CLIPS === -->
{all_clips_str}

    <!-- === MASTER AUDIO & CAPTIONS === -->
{audio_and_captions_html}
  </div>

  <script src="gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({{ paused: true }});
    window.__timelines = {{}};
    window.__timelines["main"] = tl;

    // === SCENE TRANSITIONS & HARD KILLS ===
    {gsap_transitions_str}

    // === CAPTION KARAOKE WORD HIGHLIGHTS ===
    const CAPTION_ACTIVE = "#60A5FA";
    const CAPTION_IDLE = "rgba(244, 247, 251, 0.45)";
    {caption_script_js}
  </script>
</body>
</html>
"""

output_index_path = hf_dir / "index.html"
output_index_path.write_text(full_html, encoding="utf-8")
print(f"Generated pristine index.html: {output_index_path} ({len(full_html)} bytes)")
