import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const slug = "machine-learning-tong-quan";
const starterDir = resolve(dirname(import.meta.filename), "..");
const jobDir = resolve(starterDir, "..", "jobs", slug);
const targetDir = resolve(starterDir, slug);

const beats = JSON.parse(readFileSync(join(jobDir, "beats.json"), "utf-8"));
const captionsData = JSON.parse(readFileSync(join(targetDir, "captions.json"), "utf-8"));
const captionsClipsHtml = readFileSync(join(targetDir, "captions_clips.html"), "utf-8");

const totalDuration = (beats.totalSeconds + 1.5).toFixed(2);

// Generate scene clips and animations for 52 beats
const sceneDefs = [
  // b1: Lập trình truyền thống vs thực tế
  {
    id: "b1",
    html: `
      <div class="card-hero" style="top:320px;">
        <div class="eyebrow"><span class="pulse-dot"></span> BẢN CHẤT LẬP TRÌNH</div>
        <div class="title-display">MÁY TÍNH CÓ THÔNG MINH?</div>
      </div>
      <div class="diagram-box" style="top:580px; height:580px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 540" class="svg-canvas">
          <rect x="260" y="160" width="400" height="220" rx="24" class="node-panel stroke-accent" />
          <text x="460" y="245" class="svg-text-bold" fill="#F4F7FB">BỘ XỬ LÝ (CPU)</text>
          <text x="460" y="295" class="svg-text-mono" fill="#8B94A6">THỰC THI LỆNH TĨNH</text>
          <!-- Rules & Data inputs -->
          <g id="b1-rules" transform="translate(60, 210)">
            <rect x="0" y="0" width="160" height="120" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="80" y="55" class="svg-text-mono" fill="#60A5FA">QUY TẮC</text>
            <text x="80" y="85" class="svg-text-small" fill="#8B94A6">IF / ELSE</text>
          </g>
          <path d="M 220 270 L 260 270" stroke="#60A5FA" stroke-width="6" stroke-linecap="round" marker-end="url(#arrow-blue)" />
          <g id="b1-data" transform="translate(700, 210)">
            <rect x="0" y="0" width="160" height="120" rx="16" fill="#1E293B" stroke="#60A5FA" stroke-width="3" />
            <text x="80" y="55" class="svg-text-mono" fill="#60A5FA">DỮ LIỆU</text>
            <text x="80" y="85" class="svg-text-small" fill="#8B94A6">INPUT</text>
          </g>
          <path d="M 700 270 L 660 270" stroke="#60A5FA" stroke-width="6" stroke-linecap="round" />
        </svg>
      </div>
      <div class="stamp-alert" id="b1-stamp" style="top:1180px;">HOÀN TOÀN SAI LẦM</div>
    `,
    setup: (tl, s, d) => {
      tl.fromTo("#b1-stamp", { scale: 2.2, opacity: 0, rotation: -12 }, { scale: 1, opacity: 1, rotation: -4, duration: 0.38, ease: "back.out(2)" }, s + 1.8);
    }
  },
  // b2: Sơ đồ Lập trình truyền thống
  {
    id: "b2",
    html: `
      <div class="eyebrow" style="top:260px; left:80px;">MÔ HÌNH CŨ</div>
      <div class="title-display" style="top:320px; left:80px;">LẬP TRÌNH TRUYỀN THỐNG</div>
      <div class="diagram-box" style="top:480px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 680" class="svg-canvas">
          <g transform="translate(80, 80)">
            <rect width="320" height="160" rx="20" class="node-panel stroke-accent" />
            <text x="160" y="70" class="svg-text-bold" fill="#60A5FA">1. DỮ LIỆU</text>
            <text x="160" y="115" class="svg-text-mono" fill="#8B94A6">Data / Input</text>
          </g>
          <g transform="translate(520, 80)">
            <rect width="320" height="160" rx="20" class="node-panel stroke-accent" />
            <text x="160" y="70" class="svg-text-bold" fill="#60A5FA">2. QUY TẮC</text>
            <text x="160" y="115" class="svg-text-mono" fill="#8B94A6">Code do người viết</text>
          </g>
          <!-- Mũi tên dẫn vào máy -->
          <path d="M 240 240 L 240 340 L 410 340" stroke="#60A5FA" stroke-width="6" fill="none" />
          <path d="M 680 240 L 680 340 L 510 340" stroke="#60A5FA" stroke-width="6" fill="none" />
          <g transform="translate(310, 300)">
            <rect width="300" height="180" rx="24" fill="#1E293B" stroke="#F4F7FB" stroke-width="4" />
            <text x="150" y="85" class="svg-text-bold" fill="#F4F7FB">MÁY TÍNH</text>
            <text x="150" y="130" class="svg-text-mono" fill="#60A5FA">XỬ LÝ TUẦN TỰ</text>
          </g>
          <!-- Ra kết quả -->
          <path d="M 460 480 L 460 540" stroke="#34D399" stroke-width="8" stroke-dasharray="12 8" />
          <g transform="translate(260, 540)">
            <rect width="400" height="120" rx="20" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="200" y="75" class="svg-text-bold" fill="#34D399">ĐÁP ÁN (OUTPUT)</text>
          </g>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b3: Giới hạn quá tải triệu dòng lệnh
  {
    id: "b3",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-danger"><span class="pulse-dot bg-danger"></span> GIỚI HẠN CHẾT NGƯỜI</div>
        <div class="title-display">QUÁ TẢI QUY TẮC</div>
      </div>
      <div class="stat-box" style="top:520px;">
        <div class="stat-number text-danger" id="b3-counter">1,000</div>
        <div class="stat-label">DÒNG LỆNH ĐIỀU KIỆN (IF / ELSE)</div>
      </div>
      <div class="matrix-box" style="top:840px;">
        <div class="code-line text-sub">if (pixel[0] == 255 &amp;&amp; edge == true) { ... }</div>
        <div class="code-line text-danger">if (face_angle &gt; 45 &amp;&amp; lighting &lt; 0.2) { ... }</div>
        <div class="code-line text-sub">if (is_cat &amp;&amp; !is_dog &amp;&amp; ear_shape == 3) { ... }</div>
        <div class="code-line text-danger">// BẤT LỰC VỚI HÀNG TRIỆU TÌNH HUỐNG</div>
      </div>
      <div class="badge-tag bg-danger" style="top:1200px; left:80px; right:80px; text-align:center;">
        KHÔNG THỂ VIẾT TAY HẾT TRIỆU QUY TẮC
      </div>
    `,
    setup: (tl, s, d) => {
      const obj = { val: 1000 };
      const el = document.getElementById("b3-counter");
      tl.to(obj, {
        val: 10000000,
        duration: d * 0.7,
        ease: "power2.inOut",
        onUpdate: () => { if (el) el.textContent = "> " + Math.round(obj.val).toLocaleString("en-US"); }
      }, s + 0.5);
    }
  },
  // b4: Machine Learning đảo ngược phương trình
  {
    id: "b4",
    html: `
      <div class="eyebrow text-accent" style="top:240px; left:80px;">TƯ DUY ĐỘT PHÁ</div>
      <div class="title-display" style="top:300px; left:80px;">ĐẢO NGƯỢC PHƯƠNG TRÌNH</div>
      <div class="diagram-box" style="top:460px; height:780px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 700" class="svg-canvas">
          <g transform="translate(80, 60)">
            <rect width="320" height="150" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
            <text x="160" y="65" class="svg-text-bold" fill="#60A5FA">1. DỮ LIỆU</text>
            <text x="160" y="110" class="svg-text-mono" fill="#8B94A6">Data / Examples</text>
          </g>
          <g transform="translate(520, 60)">
            <rect width="320" height="150" rx="20" fill="#1E293B" stroke="#34D399" stroke-width="4" />
            <text x="160" y="65" class="svg-text-bold" fill="#34D399">2. ĐÁP ÁN MẪU</text>
            <text x="160" y="110" class="svg-text-mono" fill="#8B94A6">Labels / Targets</text>
          </g>
          <path d="M 240 210 L 240 310 L 410 310" stroke="#60A5FA" stroke-width="6" fill="none" />
          <path d="M 680 210 L 680 310 L 510 310" stroke="#34D399" stroke-width="6" fill="none" />
          <g transform="translate(280, 270)">
            <rect width="360" height="180" rx="24" fill="#1E3A8A" stroke="#60A5FA" stroke-width="5" />
            <text x="180" y="80" class="svg-text-bold" fill="#F4F7FB">ML ENGINE</text>
            <text x="180" y="125" class="svg-text-mono" fill="#93C5FD">TỰ ĐỘNG HỌC QUY LUẬT</text>
          </g>
          <path d="M 460 450 L 460 520" stroke="#FBBF24" stroke-width="8" stroke-dasharray="10 6" />
          <g transform="translate(210, 520)">
            <rect width="500" height="140" rx="24" fill="#78350F" stroke="#FBBF24" stroke-width="5" />
            <text x="250" y="65" class="svg-text-bold" fill="#FBBF24">MÔ HÌNH QUY TẮC (MODEL)</text>
            <text x="250" y="110" class="svg-text-mono" fill="#FDE68A">TỰ SINH TỪ TRẢI NGHIỆM</text>
          </g>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b5: Định nghĩa Arthur Samuel 1959
  {
    id: "b5",
    html: `
      <div class="card-quote" style="top:320px;">
        <div class="badge-tag bg-accent mb-4">LỊCH SỬ ML • 1959</div>
        <div class="quote-text">
          “Học máy là ngành nghiên cứu mang lại cho máy tính khả năng tự học mà không cần lập trình chi tiết từng bước.”
        </div>
        <div class="quote-author mt-6">
          <div class="author-name">ARTHUR SAMUEL</div>
          <div class="author-title">Cha đẻ thuật ngữ Machine Learning (IBM Journal, 1959)</div>
        </div>
      </div>
      <div class="panel-box" style="top:920px; left:80px; right:80px; padding:40px;">
        <div class="eyebrow text-accent">TRIẾT LÝ NỀN TẢNG</div>
        <div class="body-text mt-2">
          Thay vì dạy máy từng nước cờ, hãy để máy <strong class="text-accent">tự chơi hàng nghìn ván cờ</strong> và rút ra chiến thuật!
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b6: AI vs ML vs Deep Learning
  {
    id: "b6",
    html: `
      <div class="eyebrow" style="top:220px; left:80px;">BỨC TRANH TOÀN CẢNH</div>
      <div class="title-display" style="top:280px; left:80px;">AI vs ML vs DEEP LEARNING</div>
      <div class="diagram-box" style="top:440px; height:820px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 800" class="svg-canvas">
          <!-- Vòng ngoài: AI -->
          <circle cx="460" cy="400" r="360" fill="#0F172A" stroke="#475569" stroke-width="4" />
          <text x="460" y="110" class="svg-text-bold" fill="#94A3B8">ARTIFICIAL INTELLIGENCE (AI)</text>
          <text x="460" y="150" class="svg-text-mono" fill="#64748B">Vũ trụ Trí tuệ Nhân tạo bao trùm</text>
          <!-- Vòng giữa: ML -->
          <circle cx="460" cy="440" r="260" fill="#1E293B" stroke="#60A5FA" stroke-width="5" />
          <text x="460" y="250" class="svg-text-bold" fill="#60A5FA">MACHINE LEARNING (ML)</text>
          <text x="460" y="290" class="svg-text-mono" fill="#93C5FD">Trái tim: Tự học từ Dữ liệu</text>
          <!-- Vòng nhân: Deep Learning -->
          <circle cx="460" cy="490" r="160" fill="#1E3A8A" stroke="#FBBF24" stroke-width="5" />
          <text x="460" y="460" class="svg-text-bold" fill="#FBBF24">DEEP</text>
          <text x="460" y="510" class="svg-text-bold" fill="#FBBF24">LEARNING</text>
          <text x="460" y="560" class="svg-text-mono" fill="#FDE68A">Mạng Nơ-ron Sâu</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b7: 3 Trường phái trụ cột
  {
    id: "b7",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">PHÂN LOẠI KINH ĐIỂN</div>
        <div class="title-display">3 TRƯỜNG PHÁI ML</div>
      </div>
      <div class="branch-list" style="top:480px;">
        <div class="branch-card stroke-accent">
          <div class="branch-num">01</div>
          <div class="branch-info">
            <div class="branch-name text-accent">SUPERVISED LEARNING</div>
            <div class="branch-desc">Học có giám sát (Dữ liệu có nhãn)</div>
          </div>
        </div>
        <div class="branch-card stroke-sub mt-4">
          <div class="branch-num">02</div>
          <div class="branch-info">
            <div class="branch-name text-ink">UNSUPERVISED LEARNING</div>
            <div class="branch-desc">Học không giám sát (Dữ liệu tự do)</div>
          </div>
        </div>
        <div class="branch-card stroke-sub mt-4">
          <div class="branch-num">03</div>
          <div class="branch-info">
            <div class="branch-name text-ink">REINFORCEMENT LEARNING</div>
            <div class="branch-desc">Học tăng cường (Thưởng &amp; Phạt)</div>
          </div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b8: Supervised Learning giới thiệu
  {
    id: "b8",
    html: `
      <div class="eyebrow text-accent" style="top:260px; left:80px;">TRƯỜNG PHÁI 01</div>
      <div class="title-display" style="top:320px; left:80px;">SUPERVISED LEARNING</div>
      <div class="panel-box" style="top:480px; left:80px; right:80px; padding:48px;">
        <div class="badge-tag bg-accent mb-4">HỌC CÓ GIÁM SÁT</div>
        <div class="display-sm mb-4">PHỔ BIẾN NHẤT THẾ GIỚI HIỆN NAY</div>
        <div class="body-text text-sub">
          Mỗi mẫu dữ liệu đầu vào đều đi kèm một <strong class="text-accent">nhãn đáp án chuẩn xác (Ground Truth)</strong> do con người cung cấp.
        </div>
      </div>
      <div class="stat-box" style="top:920px;">
        <div class="stat-number text-accent">&gt; 75%</div>
        <div class="stat-label">ỨNG DỤNG DOANH NGHIỆP THỰC TẾ</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b9: Minh họa dữ liệu có nhãn
  {
    id: "b9",
    html: `
      <div class="eyebrow" style="top:240px; left:80px;">CƠ CHẾ HOẠT ĐỘNG</div>
      <div class="title-display" style="top:300px; left:80px;">DỮ LIỆU KÈM NHÃN MẪU</div>
      <div class="grid-pairs" style="top:480px;">
        <div class="pair-card">
          <div class="pair-input">📷 ẢNH CHÓ</div>
          <div class="pair-arrow">➔</div>
          <div class="pair-label bg-accent">NHÃN: "CHÓ"</div>
        </div>
        <div class="pair-card mt-6">
          <div class="pair-input">📷 ẢNH MÈO</div>
          <div class="pair-arrow">➔</div>
          <div class="pair-label bg-accent">NHÃN: "MÈO"</div>
        </div>
        <div class="pair-card mt-6">
          <div class="pair-input">📧 EMAIL QUẢNG CÁO</div>
          <div class="pair-arrow">➔</div>
          <div class="pair-label bg-danger">NHÃN: "SPAM"</div>
        </div>
      </div>
      <div class="caption-tip" style="top:1120px;">
        💡 Giống học sinh giải bài tập khi đã có sẵn sách giải phía sau!
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b10: Phân loại (Classification)
  {
    id: "b10",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">NHÁNH SUPERVISED A</div>
      <div class="title-display" style="top:280px; left:80px;">BÀI TOÁN PHÂN LOẠI</div>
      <div class="diagram-box" style="top:440px; height:680px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 600" class="svg-canvas">
          <!-- Trục tọa độ -->
          <line x1="100" y1="500" x2="820" y2="500" stroke="#475569" stroke-width="3" />
          <line x1="100" y1="500" x2="100" y2="100" stroke="#475569" stroke-width="3" />
          <!-- Cụm Spam (Đỏ) -->
          <circle cx="260" cy="220" r="16" fill="#F87171" />
          <circle cx="320" cy="180" r="16" fill="#F87171" />
          <circle cx="220" cy="290" r="16" fill="#F87171" />
          <circle cx="340" cy="280" r="16" fill="#F87171" />
          <text x="260" y="140" class="svg-text-bold" fill="#F87171">NHÓM SPAM</text>
          <!-- Cụm Inbox (Xanh) -->
          <circle cx="640" cy="400" r="16" fill="#60A5FA" />
          <circle cx="700" cy="360" r="16" fill="#60A5FA" />
          <circle cx="580" cy="440" r="16" fill="#60A5FA" />
          <circle cx="740" cy="450" r="16" fill="#60A5FA" />
          <text data-layout-allow-overlap x="680" y="300" class="svg-text-bold" fill="#60A5FA">HỘP THƯ ĐẾN</text>
          <!-- Ranh giới quyết định Decision Boundary -->
          <line x1="160" y1="480" x2="740" y2="140" stroke="#FBBF24" stroke-width="6" stroke-dasharray="14 8" />
          <text data-layout-allow-overlap x="440" y="240" class="svg-text-mono" fill="#FBBF24" transform="rotate(-26 440 240)">DECISION BOUNDARY</text>
        </svg>
      </div>
      <div class="badge-list" style="top:1160px;">
        <span class="badge-tag bg-panel">📧 Lọc Thư Rác</span>
        <span class="badge-tag bg-panel">🩻 Chẩn Đoán X-Quang</span>
        <span class="badge-tag bg-panel">👤 Quét Khuôn Mặt</span>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b11: Hồi quy (Regression)
  {
    id: "b11",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">NHÁNH SUPERVISED B</div>
      <div class="title-display" style="top:280px; left:80px;">BÀI TOÁN HỒI QUY</div>
      <div class="diagram-box" style="top:440px; height:640px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 560" class="svg-canvas">
          <line x1="120" y1="460" x2="820" y2="460" stroke="#475569" stroke-width="3" />
          <line x1="120" y1="460" x2="120" y2="80" stroke="#475569" stroke-width="3" />
          <text x="470" y="520" class="svg-text-mono" fill="#8B94A6">DIỆN TÍCH NHÀ (M²)</text>
          <text x="60" y="260" class="svg-text-mono" fill="#8B94A6" transform="rotate(-90 60 260)">GIÁ NHÀ (TỶ VNĐ)</text>
          <!-- Scatter points -->
          <circle cx="200" cy="400" r="14" fill="#60A5FA" />
          <circle cx="320" cy="340" r="14" fill="#60A5FA" />
          <circle cx="440" cy="290" r="14" fill="#60A5FA" />
          <circle cx="560" cy="220" r="14" fill="#60A5FA" />
          <circle cx="680" cy="170" r="14" fill="#60A5FA" />
          <circle cx="780" cy="120" r="14" fill="#60A5FA" />
          <!-- Regression Line -->
          <line x1="150" y1="430" x2="800" y2="100" stroke="#34D399" stroke-width="6" />
        </svg>
      </div>
      <div class="stat-box" style="top:1120px;">
        <div class="stat-number text-accent" id="b11-price">4.5 TỶ</div>
        <div class="stat-label">DỰ ĐOÁN GIÁ TRỊ SỐ LIÊN TỤC</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b12: Vòng lặp sửa sai nâng độ chính xác
  {
    id: "b12",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-accent">VÒNG LẶP SỬA SAI</div>
        <div class="title-display">NÂNG TẦM ĐỘ CHÍNH XÁC</div>
      </div>
      <div class="accuracy-gauge" style="top:540px;">
        <div class="gauge-label">ACCURACY RATE</div>
        <div class="gauge-number text-accent" id="b12-acc">60.0%</div>
        <div class="progress-bar-bg mt-6">
          <div class="progress-bar-fill" id="b12-fill" style="width:60%;"></div>
        </div>
      </div>
      <div class="panel-box mt-8" style="top:880px; left:80px; right:80px; padding:36px;">
        <div class="body-text">
          So sánh liên tục: <span class="text-danger">Dự đoán sai</span> ➔ <span class="text-accent">Tính toán lỗi</span> ➔ <span class="text-emerald">Tự sửa trọng số</span>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {
      const obj = { val: 60.0 };
      const el = document.getElementById("b12-acc");
      const bar = document.getElementById("b12-fill");
      tl.to(obj, {
        val: 98.5,
        duration: d * 0.75,
        ease: "power2.out",
        onUpdate: () => {
          if (el) el.textContent = obj.val.toFixed(1) + "%";
          if (bar) bar.style.width = obj.val + "%";
        }
      }, s + 0.5);
    }
  },
  // b13: 80% Dữ liệu thực tế không có nhãn
  {
    id: "b13",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-danger"><span class="pulse-dot bg-danger"></span> THỰC TẾ KHÁCH QUAN</div>
        <div class="title-display">DỮ LIỆU KHÔNG CÓ NHÃN</div>
      </div>
      <div class="stat-box" style="top:520px;">
        <div class="stat-number text-accent">&gt; 80%</div>
        <div class="stat-label">DỮ LIỆU TOÀN CẦU LÀ DỮ LIỆU THÔ CHƯA GẮN NHÃN</div>
      </div>
      <div class="diagram-box" style="top:840px; height:420px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 360" class="svg-canvas">
          <!-- Biển chấm trắng hỗn độn -->
          <g fill="#64748B" opacity="0.6">
            <circle cx="120" cy="80" r="12" /><circle cx="220" cy="160" r="12" /><circle cx="180" cy="280" r="12" />
            <circle cx="340" cy="90" r="12" /><circle cx="420" cy="220" r="12" /><circle cx="380" cy="310" r="12" />
            <circle cx="520" cy="110" r="12" /><circle cx="620" cy="190" r="12" /><circle cx="580" cy="270" r="12" />
            <circle cx="720" cy="80" r="12" /><circle cx="800" cy="170" r="12" /><circle cx="760" cy="300" r="12" />
          </g>
          <text x="460" y="190" class="svg-text-bold" fill="#F4F7FB">HỖN ĐỘN • KHÔNG CÓ ĐÁP ÁN</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b14: Unsupervised Learning
  {
    id: "b14",
    html: `
      <div class="eyebrow text-accent" style="top:240px; left:80px;">TRƯỜNG PHÁI 02</div>
      <div class="title-display" style="top:300px; left:80px;">UNSUPERVISED LEARNING</div>
      <div class="panel-box" style="top:480px; left:80px; right:80px; padding:48px;">
        <div class="badge-tag bg-accent mb-4">HỌC KHÔNG GIÁM SÁT</div>
        <div class="display-sm mb-4">TỰ KHÁM PHÁ CẤU TRÚC ẨN</div>
        <div class="body-text text-sub">
          Không cần con người dạy hay chấm điểm. Thuật toán tự tìm ra các khuôn mẫu và quy luật tự nhiên bên trong dữ liệu.
        </div>
      </div>
      <div class="caption-tip" style="top:1060px;">
        🔦 Giống như bước vào hang động tối và tự vẽ nên bản đồ!
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b15: Phân tích khoảng cách toán học
  {
    id: "b15",
    html: `
      <div class="eyebrow" style="top:220px; left:80px;">NGUYÊN LÝ TOÁN HỌC</div>
      <div class="title-display" style="top:280px; left:80px;">KHOẢNG CÁCH EUCLIDEAN</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <circle cx="260" cy="320" r="20" fill="#60A5FA" />
          <circle cx="660" cy="320" r="20" fill="#FBBF24" />
          <!-- Khoảng cách d -->
          <line x1="280" y1="320" x2="640" y2="320" stroke="#F4F7FB" stroke-width="4" stroke-dasharray="10 8" />
          <text x="460" y="280" class="svg-text-mono" fill="#F4F7FB">d = √[ Σ (x_i - y_i)² ]</text>
          <text x="260" y="380" class="svg-text-bold" fill="#60A5FA">ĐIỂM A</text>
          <text x="660" y="380" class="svg-text-bold" fill="#FBBF24">ĐIỂM B</text>
          <rect x="180" y="480" width="560" height="120" rx="16" fill="#1E293B" stroke="#475569" stroke-width="3" />
          <text x="460" y="550" class="svg-text-mono" fill="#34D399">GẦN NHAU = CÙNG MỘT NHÓM</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b16: Phân cụm (Clustering)
  {
    id: "b16",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">KỸ THUẬT NỀN TẢNG</div>
      <div class="title-display" style="top:280px; left:80px;">PHÂN CỤM (CLUSTERING)</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <!-- Cụm 1: VIP (Vàng) -->
          <circle cx="260" cy="220" r="140" fill="#78350F" opacity="0.4" />
          <circle cx="240" cy="200" r="14" fill="#FBBF24" /><circle cx="280" cy="230" r="14" fill="#FBBF24" /><circle cx="250" cy="260" r="14" fill="#FBBF24" />
          <text x="260" y="120" class="svg-text-bold" fill="#FBBF24">KHÁCH VIP</text>
          <!-- Cụm 2: Phổ thông (Xanh) -->
          <circle cx="660" cy="240" r="140" fill="#1E3A8A" opacity="0.4" />
          <circle cx="640" cy="220" r="14" fill="#60A5FA" /><circle cx="680" cy="260" r="14" fill="#60A5FA" /><circle cx="630" cy="270" r="14" fill="#60A5FA" />
          <text x="660" y="140" class="svg-text-bold" fill="#60A5FA">PHỔ THÔNG</text>
          <!-- Cụm 3: Tiềm năng (Lá) -->
          <circle cx="460" cy="480" r="130" fill="#064E3B" opacity="0.4" />
          <circle cx="440" cy="460" r="14" fill="#34D399" /><circle cx="480" cy="490" r="14" fill="#34D399" /><circle cx="450" cy="520" r="14" fill="#34D399" />
          <text x="460" y="400" class="svg-text-bold" fill="#34D399">TIỀM NĂNG</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b17: Giảm chiều dữ liệu
  {
    id: "b17",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="eyebrow text-accent">KỸ THUẬT NÂNG CAO</div>
        <div class="title-display">GIẢM CHIỀU DỮ LIỆU</div>
      </div>
      <div class="panel-box" style="top:500px; left:80px; right:80px; padding:44px;">
        <div class="grid-2col">
          <div class="col-box">
            <div class="stat-number text-sub">3D / 1000D</div>
            <div class="stat-label">HÀNG NGHÌN THUỘC TÍNH</div>
          </div>
          <div class="col-arrow text-accent">➔</div>
          <div class="col-box">
            <div class="stat-number text-accent">2D</div>
            <div class="stat-label">MẶT PHẲNG TRỰC QUAN</div>
          </div>
        </div>
      </div>
      <div class="badge-list" style="top:920px;">
        <span class="badge-tag bg-panel">PCA (Principal Component)</span>
        <span class="badge-tag bg-panel">t-SNE &amp; UMAP</span>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b18: Reinforcement Learning
  {
    id: "b18",
    html: `
      <div class="eyebrow text-accent" style="top:240px; left:80px;">TRƯỜNG PHÁI 03</div>
      <div class="title-display" style="top:300px; left:80px;">REINFORCEMENT LEARNING</div>
      <div class="panel-box" style="top:480px; left:80px; right:80px; padding:48px;">
        <div class="badge-tag bg-accent mb-4">HỌC TĂNG CƯỜNG</div>
        <div class="display-sm mb-4">ĐỘC ĐÁO &amp; MẠNH MẼ NHẤT</div>
        <div class="body-text text-sub">
          Không cần nhãn, không cần sách giải. Một <strong class="text-accent">Agent tự hành động</strong> trong môi trường để tối đa hóa điểm thưởng.
        </div>
      </div>
      <div class="stat-box" style="top:960px;">
        <div class="stat-number text-accent">AGENT ⇄ MÔI TRƯỜNG</div>
        <div class="stat-label">VÒNG LẶP HÀNH ĐỘNG &amp; THƯỞNG PHẠT</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b19: Sơ đồ Agent - Action - Environment - Reward
  {
    id: "b19",
    html: `
      <div class="eyebrow" style="top:220px; left:80px;">CƠ CHẾ VẬN HÀNH</div>
      <div class="title-display" style="top:280px; left:80px;">VÒNG LẶP HỌC TĂNG CƯỜNG</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <!-- Agent Box -->
          <g transform="translate(100, 240)">
            <rect width="280" height="180" rx="20" fill="#1E3A8A" stroke="#60A5FA" stroke-width="4" />
            <text x="140" y="80" class="svg-text-bold" fill="#60A5FA">AGENT</text>
            <text x="140" y="125" class="svg-text-mono" fill="#93C5FD">Tác Tử Thông Minh</text>
          </g>
          <!-- Environment Box -->
          <g transform="translate(540, 240)">
            <rect width="280" height="180" rx="20" fill="#064E3B" stroke="#34D399" stroke-width="4" />
            <text x="140" y="80" class="svg-text-bold" fill="#34D399">ENVIRONMENT</text>
            <text x="140" y="125" class="svg-text-mono" fill="#A7F3D0">Môi Trường</text>
          </g>
          <!-- Action Arrow (Top) -->
          <path d="M 380 290 L 540 290" stroke="#FBBF24" stroke-width="6" marker-end="url(#arrow-gold)" />
          <text x="460" y="260" class="svg-text-mono" fill="#FBBF24">HÀNH ĐỘNG (ACTION)</text>
          <!-- State & Reward Arrow (Bottom) -->
          <path d="M 540 370 L 380 370" stroke="#60A5FA" stroke-width="6" />
          <text x="460" y="420" class="svg-text-mono" fill="#60A5FA">TRẠNG THÁI (STATE) + THƯỞNG (REWARD)</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b20: Điểm thưởng và Điểm phạt
  {
    id: "b20",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-accent">TỐI ƯU HÓA HÀNH VI</div>
        <div class="title-display">THƯỞNG VÀ PHẠT</div>
      </div>
      <div class="grid-pairs" style="top:540px;">
        <div class="pair-card stroke-success">
          <div class="pair-input text-success">🎯 ĐẠT MỤC TIÊU</div>
          <div class="pair-arrow">➔</div>
          <div class="stat-number text-success">+ 100 ĐIỂM</div>
        </div>
        <div class="pair-card stroke-danger mt-8">
          <div class="pair-input text-danger">💥 VA CHẠM VẬT CẢN</div>
          <div class="pair-arrow">➔</div>
          <div class="stat-number text-danger">- 50 ĐIỂM</div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b21: Thử và sai triệu ván đấu
  {
    id: "b21",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-accent">TIẾN HÓA CHIẾN THUẬT</div>
        <div class="title-display">THỬ &amp; SAI HÀNG TRIỆU LẦN</div>
      </div>
      <div class="stat-box" style="top:540px;">
        <div class="stat-number text-accent" id="b21-games">1,000,000</div>
        <div class="stat-label">VÁN TỰ ĐẤU LIÊN TỤC ĐỂ ĐẠT TỐI ƯU</div>
      </div>
      <div class="panel-box mt-8" style="top:880px; left:80px; right:80px; padding:36px;">
        <div class="body-text">
          Từ những bước đi chập chững ngẫu nhiên ban đầu ➔ trở thành <strong class="text-accent">bậc thầy chiến thuật</strong> vượt xa con người!
        </div>
      </div>
    `,
    setup: (tl, s, d) => {
      const obj = { val: 1 };
      const el = document.getElementById("b21-games");
      tl.to(obj, {
        val: 1000000,
        duration: d * 0.7,
        ease: "power3.inOut",
        onUpdate: () => { if (el) el.textContent = Math.round(obj.val).toLocaleString("en-US"); }
      }, s + 0.5);
    }
  },
  // b22: AlphaGo 2016 Nature
  {
    id: "b22",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="badge-tag bg-accent mb-4">CỘT MỐC LỊCH SỬ • 2016</div>
        <div class="title-display">ALPHAGO ĐÁNH BẠI LEE SEDOL</div>
      </div>
      <div class="panel-box" style="top:520px; left:80px; right:80px; padding:48px;">
        <div class="grid-2col">
          <div class="col-box">
            <div class="stat-number text-accent">4 - 1</div>
            <div class="stat-label">TỈ SỐ CHUNG CUỘC</div>
          </div>
          <div class="col-box">
            <div class="display-sm text-gold">NƯỚC ĐI 37</div>
            <div class="stat-label">NƯỚC CỜ "THẦN THÁNH" TỶ LỆ 1/10.000</div>
          </div>
        </div>
      </div>
      <div class="quote-source" style="top:1000px; left:80px; right:80px;">
        📄 Công bố trên tạp chí Nature (Silver et al., 2016)
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b23: Deep Learning Mạng nơ-ron sâu
  {
    id: "b23",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">ĐỘT PHÁ CÔNG NGHỆ</div>
      <div class="title-display" style="top:280px; left:80px;">DEEP LEARNING (HỌC SÂU)</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <!-- Input Layer -->
          <circle cx="160" cy="180" r="20" fill="#60A5FA" /><circle cx="160" cy="320" r="20" fill="#60A5FA" /><circle cx="160" cy="460" r="20" fill="#60A5FA" />
          <text x="160" y="540" class="svg-text-mono" fill="#60A5FA">INPUT</text>
          <!-- Hidden Layer 1 -->
          <circle cx="360" cy="120" r="20" fill="#FBBF24" /><circle cx="360" cy="240" r="20" fill="#FBBF24" /><circle cx="360" cy="360" r="20" fill="#FBBF24" /><circle cx="360" cy="480" r="20" fill="#FBBF24" />
          <!-- Hidden Layer 2 -->
          <circle cx="560" cy="120" r="20" fill="#FBBF24" /><circle cx="560" cy="240" r="20" fill="#FBBF24" /><circle cx="560" cy="360" r="20" fill="#FBBF24" /><circle cx="560" cy="480" r="20" fill="#FBBF24" />
          <text x="460" y="540" class="svg-text-mono" fill="#FBBF24">HIDDEN LAYERS</text>
          <!-- Output Layer -->
          <circle cx="760" cy="240" r="20" fill="#34D399" /><circle cx="760" cy="380" r="20" fill="#34D399" />
          <text x="760" y="540" class="svg-text-mono" fill="#34D399">OUTPUT</text>
          <!-- Dense connections -->
          <path d="M 180 180 L 340 120 M 180 180 L 340 240 M 180 320 L 340 240 M 180 320 L 340 360 M 380 240 L 540 240 M 380 360 L 540 360 M 580 240 L 740 240 M 580 360 L 740 380" stroke="#475569" stroke-width="2" />
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b24: Bên trong cỗ máy: Đường ống 4 bước
  {
    id: "b24",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">TRÁI TIM CỖ MÁY</div>
        <div class="title-display">PIPELINE HUẤN LUYỆN</div>
      </div>
      <div class="step-list" style="top:480px;">
        <div class="step-item"><span class="step-badge">1</span> TRÍCH XUẤT ĐẶC TRƯNG (FEATURES)</div>
        <div class="step-item mt-4"><span class="step-badge">2</span> MÔ HÌNH TOÁN &amp; TRỌNG SỐ (WEIGHTS)</div>
        <div class="step-item mt-4"><span class="step-badge">3</span> HÀM MẤT MÁT (LOSS FUNCTION)</div>
        <div class="step-item mt-4"><span class="step-badge">4</span> TỐI ƯU HÓA (GRADIENT DESCENT)</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b25: Trích xuất đặc trưng (Features)
  {
    id: "b25",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">BƯỚC 01</div>
      <div class="title-display" style="top:280px; left:80px;">TRÍCH XUẤT ĐẶC TRƯNG</div>
      <div class="panel-box" style="top:440px; left:80px; right:80px; padding:44px;">
        <div class="stat-label mb-2">DỮ LIỆU THÔ ➔ VECTƠ TOÁN HỌC</div>
        <div class="code-box font-mono text-accent">
          X = [ chiều_cao, cân_nặng, tuổi, thu_nhập ]<br>
          X = [ 1.75, 68.5, 28, 35000000 ]
        </div>
      </div>
      <div class="badge-tag bg-panel" style="top:840px; left:80px; right:80px; text-align:center;">
        MÁY TÍNH CHỈ HIỂU VÀ TÍNH TOÁN TRÊN CÁC CON SỐ!
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b26: Trọng số khởi tạo ngẫu nhiên
  {
    id: "b26",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">BƯỚC 02</div>
      <div class="title-display" style="top:280px; left:80px;">TRỌNG SỐ (WEIGHTS)</div>
      <div class="diagram-box" style="top:440px; height:680px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 600" class="svg-canvas">
          <rect x="180" y="140" width="560" height="280" rx="20" fill="#1E293B" stroke="#60A5FA" stroke-width="4" />
          <text x="460" y="220" class="svg-text-bold" fill="#F4F7FB">ŷ = W · X + b</text>
          <text x="460" y="280" class="svg-text-mono" fill="#8B94A6">W = [0.12, -0.45, 0.89, 0.03]</text>
          <text x="460" y="340" class="svg-text-small" fill="#FBBF24">BAN ĐẦU KHỞI TẠO HOÀN TOÀN NGẪU NHIÊN</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b27: Loss Function
  {
    id: "b27",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="eyebrow text-danger"><span class="pulse-dot bg-danger"></span> BƯỚC 03</div>
        <div class="title-display">LOSS FUNCTION (HÀM MẤT MÁT)</div>
      </div>
      <div class="stat-box stroke-danger" style="top:520px;">
        <div class="stat-number text-danger" id="b27-loss">3.85</div>
        <div class="stat-label">THƯỚC ĐO SAI SỐ GIỮA DỰ ĐOÁN VÀ THỰC TẾ</div>
      </div>
      <div class="panel-box mt-8" style="top:860px; left:80px; right:80px; padding:36px;">
        <div class="font-mono text-accent" style="font-size:38px;">Loss = (y_thật - y_dự_đoán)²</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b28: Mục tiêu kéo Loss về 0
  {
    id: "b28",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="eyebrow text-accent">MỤC TIÊU TỐI THƯỢNG</div>
        <div class="title-display">ÉP LOSS FUNCTION VỀ 0</div>
      </div>
      <div class="stat-box stroke-success" style="top:520px;">
        <div class="stat-number text-success" id="b28-loss">0.02</div>
        <div class="stat-label">LOSS CÀNG NHỎ ➔ MÔ HÌNH CÀNG THÔNG MINH</div>
      </div>
      <div class="badge-tag bg-success" style="top:860px; left:80px; right:80px; text-align:center;">
        TỐI ƯU HÓA TOÁN HỌC = BẢN CHẤT CỦA SỰ HỌC!
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b29: Gradient Descent (Người mù xuống núi)
  {
    id: "b29",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">BƯỚC 04 • TỐI ƯU</div>
      <div class="title-display" style="top:280px; left:80px;">GRADIENT DESCENT</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <!-- Đường cong lòng chảo Parabol -->
          <path d="M 120 160 Q 460 620 800 160" stroke="#60A5FA" stroke-width="6" fill="none" />
          <!-- Điểm bóng lăn -->
          <circle cx="220" cy="300" r="22" fill="#F87171" id="b29-ball" />
          <!-- Đáy thung lũng -->
          <circle cx="460" cy="505" r="16" fill="#34D399" />
          <text x="460" y="560" class="svg-text-bold" fill="#34D399">ĐIỂM TỐI TIỂU (MINIMUM)</text>
          <text x="220" y="240" class="svg-text-mono" fill="#F87171">VỊ TRÍ BAN ĐẦU</text>
        </svg>
      </div>
      <div class="caption-tip" style="top:1180px;">
        ⛰️ Giống như người bị bịt mắt lần bước xuống đáy thung lũng!
      </div>
    `,
    setup: (tl, s, d) => {
      tl.to("#b29-ball", { cx: 460, cy: 505, duration: d * 0.7, ease: "power2.inOut" }, s + 0.5);
    }
  },
  // b30: Đạo hàm & Learning Rate
  {
    id: "b30",
    html: `
      <div class="eyebrow" style="top:220px; left:80px;">CÔNG THỨC CẬP NHẬT</div>
      <div class="title-display" style="top:280px; left:80px;">LEARNING RATE (α)</div>
      <div class="panel-box" style="top:440px; left:80px; right:80px; padding:48px;">
        <div class="display-sm font-mono text-accent mb-4">W_mới = W_cũ - α · ∇Loss</div>
        <div class="body-text text-sub">
          <strong>α (Learning Rate)</strong>: Kích thước bước nhảy của mỗi lần điều chỉnh trọng số.
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b31: Nguy cơ Learning Rate Quá lớn vs Quá nhỏ
  {
    id: "b31",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-danger">HIỂM HỌA THAM SỐ</div>
        <div class="title-display">CHỌN SAI LEARNING RATE</div>
      </div>
      <div class="grid-pairs" style="top:480px;">
        <div class="pair-card stroke-danger">
          <div class="pair-input text-danger">QUÁ LỚN (α &gt; 1.0)</div>
          <div class="pair-label bg-danger">NHẢY VỌT RA NGOÀI</div>
        </div>
        <div class="pair-card stroke-sub mt-8">
          <div class="pair-input text-sub">QUÁ NHỎ (α &lt; 0.00001)</div>
          <div class="pair-label bg-panel">MẤT HÀNG THẬP KỶ ĐỂ HỌC</div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b32: Backpropagation
  {
    id: "b32",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">THUẬT TOÁN HUYỀN THOẠI</div>
      <div class="title-display" style="top:280px; left:80px;">BACKPROPAGATION</div>
      <div class="panel-box" style="top:440px; left:80px; right:80px; padding:48px;">
        <div class="badge-tag bg-accent mb-4">LAN TRUYỀN NGƯỢC (1986)</div>
        <div class="display-sm mb-4">TRUYỀN SAI SỐ TỪ SAU RA TRƯỚC</div>
        <div class="body-text text-sub">
          Quy tắc chuỗi (Chain Rule) tính toán chính xác từng nơ-ron chịu trách nhiệm bao nhiêu phần trăm lỗi để tự sửa.
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b33: Epoch và Hội tụ
  {
    id: "b33",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="eyebrow text-accent">CHU TRÌNH HUẤN LUYỆN</div>
        <div class="title-display">EPOCH &amp; SỰ HỘI TỤ</div>
      </div>
      <div class="stat-box" style="top:520px;">
        <div class="stat-number text-accent" id="b33-epoch">1,000</div>
        <div class="stat-label">CHU KỲ DUYỆT QUA TOÀN BỘ TẬP DỮ LIỆU</div>
      </div>
      <div class="stamp-alert stroke-success text-success" style="top:880px;">MÔ HÌNH HỘI TỤ THÀNH CÔNG</div>
    `,
    setup: (tl, s, d) => {
      const obj = { val: 1 };
      const el = document.getElementById("b33-epoch");
      tl.to(obj, {
        val: 1000,
        duration: d * 0.7,
        ease: "power2.inOut",
        onUpdate: () => { if (el) el.textContent = Math.round(obj.val).toLocaleString("en-US"); }
      }, s + 0.5);
    }
  },
  // b34: Cạm bẫy Overfitting
  {
    id: "b34",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-danger"><span class="pulse-dot bg-danger"></span> CẠM BẪY SỐ 1</div>
        <div class="title-display">OVERFITTING (HỌC VẸT)</div>
      </div>
      <div class="stamp-alert stroke-danger text-danger" style="top:620px;">
        CẢNH BÁO: HỌC VẸT DỮ LIỆU
      </div>
      <div class="panel-box" style="top:840px; left:80px; right:80px; padding:40px;">
        <div class="body-text">
          Mô hình nhớ từng chi tiết vụn vặt của đề thi cũ, nhưng bước vào phòng thi gặp bài mới thì <strong class="text-danger">bị điểm 0</strong>!
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b35: Minh họa đồ thị Overfitting
  {
    id: "b35",
    html: `
      <div class="eyebrow text-danger" style="top:220px; left:80px;">QUÁ PHỨC TẠP</div>
      <div class="title-display" style="top:280px; left:80px;">ĐỒ THỊ OVERFITTING</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <!-- Đường cong uốn lượn lắt léo quanh noise -->
          <path d="M 100 450 Q 200 100 300 450 T 500 120 T 700 480 T 820 150" stroke="#F87171" stroke-width="6" fill="none" />
          <circle cx="200" cy="180" r="14" fill="#60A5FA" /><circle cx="300" cy="420" r="14" fill="#60A5FA" /><circle cx="500" cy="160" r="14" fill="#60A5FA" />
          <text x="460" y="580" class="svg-text-bold" fill="#F87171">GHI NHỚ CẢ NHIỄU DỮ LIỆU</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b36: Underfitting (Quá thô sơ)
  {
    id: "b36",
    html: `
      <div class="eyebrow text-danger" style="top:220px; left:80px;">QUÁ THÔ SƠ</div>
      <div class="title-display" style="top:280px; left:80px;">UNDERFITTING</div>
      <div class="diagram-box" style="top:440px; height:740px;">
        <svg data-layout-allow-overlap viewBox="0 0 920 660" class="svg-canvas">
          <line x1="120" y1="400" x2="800" y2="200" stroke="#F87171" stroke-width="6" />
          <circle cx="200" cy="180" r="14" fill="#60A5FA" /><circle cx="300" cy="420" r="14" fill="#60A5FA" /><circle cx="500" cy="160" r="14" fill="#60A5FA" />
          <text x="460" y="580" class="svg-text-bold" fill="#F87171">KHÔNG HỌC ĐƯỢC QUY LUẬT</text>
        </svg>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b37: Bias-Variance Tradeoff
  {
    id: "b37",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">NGUYÊN LÝ VÀNG</div>
        <div class="title-display">BIAS-VARIANCE TRADEOFF</div>
      </div>
      <div class="grid-3col" style="top:480px;">
        <div class="col-card stroke-danger">
          <div class="col-title text-danger">UNDERFIT</div>
          <div class="col-desc">High Bias (Quá cứng nhắc)</div>
        </div>
        <div class="col-card stroke-success">
          <div class="col-title text-success">GOOD FIT</div>
          <div class="col-desc">Vừa vặn &amp; Tổng quát</div>
        </div>
        <div class="col-card stroke-danger">
          <div class="col-title text-danger">OVERFIT</div>
          <div class="col-desc">High Variance (Học vẹt)</div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b38: Kỹ thuật Regularization & Dropout
  {
    id: "b38",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">GIẢI PHÁP TỐI ƯU</div>
      <div class="title-display" style="top:280px; left:80px;">REGULARIZATION &amp; DROPOUT</div>
      <div class="panel-box" style="top:440px; left:80px; right:80px; padding:44px;">
        <div class="step-item"><span class="step-badge">L1/L2</span> PHẠT MÔ HÌNH QUÁ PHỨC TẠP</div>
        <div class="step-item mt-4"><span class="step-badge">DROPOUT</span> TẮT NGẪU NHIÊN 20-50% NƠ-RON</div>
      </div>
      <div class="badge-tag bg-success" style="top:840px; left:80px; right:80px; text-align:center;">
        BẮT MẠNG HỌC CÁC ĐƯỜNG ĐI ĐỘC LẬP!
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b39: Chia 3 tập dữ liệu: Train / Val / Test
  {
    id: "b39",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">QUY TẮC BẤT BIẾN</div>
        <div class="title-display">CHIA 3 TẬP DỮ LIỆU</div>
      </div>
      <div class="split-bar-box" style="top:520px;">
        <div class="split-segment bg-accent" style="width:70%;">TRAIN (70%)</div>
        <div class="split-segment bg-gold" style="width:15%;">VAL (15%)</div>
        <div class="split-segment bg-success" style="width:15%;">TEST (15%)</div>
      </div>
      <div class="panel-box mt-8" style="top:740px; left:80px; right:80px; padding:36px;">
        <div class="body-text">
          Tuyệt đối <strong class="text-danger">không dùng tập Test để huấn luyện</strong> — đó là đề thi tốt nghiệp cuối cùng!
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b40: K-Fold Cross-Validation
  {
    id: "b40",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">KIỂM ĐỊNH NÂNG CAO</div>
      <div class="title-display" style="top:280px; left:80px;">K-FOLD CROSS-VALIDATION</div>
      <div class="kfold-diagram" style="top:440px;">
        <div class="kfold-row"><span class="fold-seg bg-accent">F1</span><span class="fold-seg bg-accent">F2</span><span class="fold-seg bg-accent">F3</span><span class="fold-seg bg-accent">F4</span><span class="fold-seg bg-success">TEST</span></div>
        <div class="kfold-row mt-2"><span class="fold-seg bg-accent">F1</span><span class="fold-seg bg-accent">F2</span><span class="fold-seg bg-accent">F3</span><span class="fold-seg bg-success">TEST</span><span class="fold-seg bg-accent">F5</span></div>
        <div class="kfold-row mt-2"><span class="fold-seg bg-accent">F1</span><span class="fold-seg bg-accent">F2</span><span class="fold-seg bg-success">TEST</span><span class="fold-seg bg-accent">F4</span><span class="fold-seg bg-accent">F5</span></div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b41: Bẫy Accuracy
  {
    id: "b41",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-danger"><span class="pulse-dot bg-danger"></span> CẠM BẪY ĐÁNH GIÁ</div>
        <div class="title-display">BẪY ĐỘ CHÍNH XÁC</div>
      </div>
      <div class="stamp-alert stroke-danger text-danger" style="top:600px;">
        CẢNH BÁO: BẪY ACCURACY
      </div>
      <div class="panel-box" style="top:840px; left:80px; right:80px; padding:36px;">
        <div class="body-text">
          Đừng để con số Accuracy đánh lừa trong các bài toán chẩn đoán ung thư hoặc phát hiện gian lận!
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b42: Mất cân bằng dữ liệu 99%
  {
    id: "b42",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-danger">DỮ LIỆU MẤT CÂN BẰNG</div>
        <div class="title-display">BÀI TOÁN 99% ÂM TÍNH</div>
      </div>
      <div class="grid-pairs" style="top:480px;">
        <div class="pair-card stroke-accent">
          <div class="pair-input">ACCURACY</div>
          <div class="stat-number text-accent">99.0%</div>
        </div>
        <div class="pair-card stroke-danger mt-6">
          <div class="pair-input">PHÁT HIỆN BỆNH</div>
          <div class="stat-number text-danger">0.0%</div>
        </div>
      </div>
      <div class="badge-tag bg-danger" style="top:980px; left:80px; right:80px; text-align:center;">
        ĐOÁN TẤT CẢ LÀ KHỎE ➔ BỎ SÓT TOÀN BỘ BỆNH NHÂN!
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b43: Precision vs Recall (Confusion Matrix)
  {
    id: "b43",
    html: `
      <div class="eyebrow text-accent" style="top:220px; left:80px;">THƯỚC ĐO CHUẨN MỰC</div>
      <div class="title-display" style="top:280px; left:80px;">PRECISION &amp; RECALL</div>
      <div class="confusion-matrix" style="top:440px;">
        <div class="cm-grid">
          <div class="cm-cell bg-success">TRUE POSITIVE</div>
          <div class="cm-cell bg-danger">FALSE POSITIVE</div>
          <div class="cm-cell bg-danger">FALSE NEGATIVE</div>
          <div class="cm-cell bg-success">TRUE NEGATIVE</div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b44: F1-Score
  {
    id: "b44",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="eyebrow text-accent">ĐIỂM CÂN BẰNG</div>
        <div class="title-display">F1-SCORE</div>
      </div>
      <div class="panel-box" style="top:500px; left:80px; right:80px; padding:48px;">
        <div class="stat-number text-gold">F1 = 2 · (P · R) / (P + R)</div>
        <div class="stat-label mt-4">TRUNG BÌNH ĐIỀU HÒA GIỮA PRECISION &amp; RECALL</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b45: Đánh giá Hồi quy MAE & MSE
  {
    id: "b45",
    html: `
      <div class="eyebrow" style="top:220px; left:80px;">ĐÁNH GIÁ HỒI QUY</div>
      <div class="title-display" style="top:280px; left:80px;">MAE &amp; MSE</div>
      <div class="grid-pairs" style="top:460px;">
        <div class="pair-card">
          <div class="pair-input text-accent">MAE</div>
          <div class="body-text">Sai số Tuyệt đối Trung bình</div>
        </div>
        <div class="pair-card mt-6">
          <div class="pair-input text-gold">MSE / RMSE</div>
          <div class="body-text">Sai số Bình phương (Phạt nặng ngoại lai)</div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b46: MLOps Pipeline
  {
    id: "b46",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">VẬN HÀNH THỰC TẾ</div>
        <div class="title-display">MLOPS PIPELINE</div>
      </div>
      <div class="step-list" style="top:480px;">
        <div class="step-item"><span class="step-badge">1</span> CI/CD &amp; RETRAINING</div>
        <div class="step-item mt-4"><span class="step-badge">2</span> MODEL REGISTRY</div>
        <div class="step-item mt-4"><span class="step-badge">3</span> CLOUD INFERENCE API</div>
        <div class="step-item mt-4"><span class="step-badge">4</span> MONITORING DATA DRIFT</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b47: Ba bánh răng Toán học
  {
    id: "b47",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">BẢN CHẤT CỐT LÕI</div>
        <div class="title-display">KIỀNG 3 CHÂN TOÁN HỌC</div>
      </div>
      <div class="grid-3col" style="top:480px;">
        <div class="col-card stroke-accent">
          <div class="col-title text-accent">ĐẠI SỐ TUYẾN TÍNH</div>
          <div class="col-desc">Ma trận &amp; Vectơ</div>
        </div>
        <div class="col-card stroke-gold">
          <div class="col-title text-gold">XÁC SUẤT THỐNG KÊ</div>
          <div class="col-desc">Phân phối &amp; Bayes</div>
        </div>
        <div class="col-card stroke-success">
          <div class="col-title text-success">GIẢI TÍCH &amp; TỐI ƯU</div>
          <div class="col-desc">Đạo hàm &amp; Gradient</div>
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b48: Hệ sinh thái công cụ
  {
    id: "b48",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">HỆ SINH THÁI</div>
        <div class="title-display">CÔNG CỤ HÀNG ĐẦU</div>
      </div>
      <div class="badge-list-lg" style="top:480px;">
        <div class="badge-card stroke-accent">🐍 PYTHON</div>
        <div class="badge-card stroke-gold mt-4">⚙️ SCIKIT-LEARN</div>
        <div class="badge-card stroke-danger mt-4">🔥 PYTORCH</div>
        <div class="badge-card stroke-accent mt-4">🧠 TENSORFLOW</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b49: Thống kê Stanford 70% doanh nghiệp
  {
    id: "b49",
    html: `
      <div class="card-hero" style="top:240px;">
        <div class="eyebrow text-accent">BÁO CÁO STANFORD AI INDEX 2024</div>
        <div class="title-display">LÀN SÓNG TOÀN CẦU</div>
      </div>
      <div class="stat-box" style="top:520px;">
        <div class="stat-number text-accent">&gt; 70%</div>
        <div class="stat-label">DOANH NGHIỆP TOÀN CẦU ĐANG TÍCH HỢP ML &amp; AI</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b50: Ứng dụng thực tế
  {
    id: "b50",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">ỨNG DỤNG THỰC TẾ</div>
        <div class="title-display">ĐỔI THAY THẾ GIỚI</div>
      </div>
      <div class="grid-2col-cards" style="top:480px;">
        <div class="app-card">🏥 Y TẾ CHÍNH XÁC</div>
        <div class="app-card">📈 TÀI CHÍNH ĐỊNH LƯỢNG</div>
        <div class="app-card">🚗 XE TỰ LÁI</div>
        <div class="app-card">🤖 AI TẠO SINH &amp; LLM</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b51: 3 Nguyên tắc vàng
  {
    id: "b51",
    html: `
      <div class="card-hero" style="top:220px;">
        <div class="eyebrow text-accent">TỔNG KẾT BÀI HỌC</div>
        <div class="title-display">3 NGUYÊN TẮC VÀNG</div>
      </div>
      <div class="step-list" style="top:480px;">
        <div class="step-item"><span class="step-badge">1</span> DỮ LIỆU SẠCH &amp; CHẤT LƯỢNG</div>
        <div class="step-item mt-4"><span class="step-badge">2</span> CHỌN MÔ HÌNH PHÙ HỢP BÀI TOÁN</div>
        <div class="step-item mt-4"><span class="step-badge">3</span> ĐÁNH GIÁ TRUNG THỰC &amp; ĐA CHIỀU</div>
      </div>
    `,
    setup: (tl, s, d) => {}
  },
  // b52: CTA Kết thúc
  {
    id: "b52",
    html: `
      <div class="card-hero" style="top:260px;">
        <div class="eyebrow text-accent">HÀNH ĐỘNG TIẾP THEO</div>
        <div class="title-display">BẠN MUỐN ĐI SÂU THUẬT TOÁN NÀO?</div>
      </div>
      <div class="panel-box" style="top:520px; left:80px; right:80px; padding:48px;">
        <div class="display-sm text-gold mb-4">HÃY ĐỂ LẠI BÌNH LUẬN!</div>
        <div class="body-text text-sub">
          Đăng ký kênh để đón xem các tập thực hành code Machine Learning tiếp theo nhé!
        </div>
      </div>
    `,
    setup: (tl, s, d) => {}
  }
];

// Build scene clips HTML
const sceneClipsHtml = beats.beats.map((b, idx) => {
  const def = sceneDefs[idx] || { id: b.id, html: `<div class="card-hero" style="top:320px;"><div class="title-display">${b.id}</div></div>` };
  return `    <!-- Beat ${b.id} (${b.start.toFixed(2)}s - ${(b.start + b.duration).toFixed(2)}s) -->
    <section id="${b.id}" class="clip scene-clip" data-start="${b.start.toFixed(2)}" data-duration="${b.duration.toFixed(2)}" data-track-index="1">
      <div class="scene-inner">
        ${def.html.trim()}
      </div>
    </section>`;
}).join("\n\n");

// Build GSAP animation JS
const sceneAnimJs = beats.beats.map((b, idx) => {
  const isFirst = idx === 0;
  const isLast = idx === beats.beats.length - 1;
  const s = b.start;
  const d = b.duration;
  const def = sceneDefs[idx];

  let js = `  // Beat ${b.id}\n`;
  if (!isFirst) {
    js += `  tl.fromTo("#${b.id} .scene-inner", { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "none" }, ${s.toFixed(2)});\n`;
  }
  if (!isLast) {
    js += `  tl.to("#${b.id} .scene-inner", { opacity: 0, duration: 0.28, ease: "none" }, ${(s + d - 0.28).toFixed(2)});\n`;
    js += `  tl.set("#${b.id} .scene-inner", { opacity: 0 }, ${(s + d).toFixed(2)});\n`;
  }
  return js;
}).join("\n");

// Complete index.html template
const indexHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Machine Learning là gì &amp; Tổng quan Toàn bộ Khái niệm Cốt lõi</title>
  <style>
    /* Inline Font-face definitions for StaticGuard */
    @font-face { font-family:'Literata'; font-style:normal; font-weight:900; src:url('fonts/Literata-900-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }
    @font-face { font-family:'Literata'; font-style:normal; font-weight:900; src:url('fonts/Literata-900-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }
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

    /* Core Tokens */
    :root {
      --bg: #0B0E14;
      --ink: #F4F7FB;
      --ink-sub: #8B94A6;
      --accent: #60A5FA;
      --accent-danger: #F87171;
      --accent-success: #34D399;
      --accent-gold: #FBBF24;
      --panel: #121722;
      --radius: 24px;
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
    }

    .scene-inner {
      position: absolute;
      inset: 0;
      padding: 0 80px;
    }

    /* Typography */
    .eyebrow {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 36px;
      font-weight: 600;
      letter-spacing: 4px;
      text-transform: uppercase;
      color: var(--accent);
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .title-display {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 68px;
      font-weight: 900;
      line-height: 1.15;
      letter-spacing: -1px;
      color: var(--ink);
      margin-top: 16px;
    }

    .display-sm {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 48px;
      font-weight: 900;
      line-height: 1.2;
    }

    .body-text {
      font-size: 42px;
      font-weight: 400;
      line-height: 1.45;
      color: var(--ink);
    }

    .font-mono { font-family: 'IBM Plex Mono', monospace; }
    .text-accent { color: var(--accent) !important; }
    .text-danger { color: var(--accent-danger) !important; }
    .text-success { color: var(--accent-success) !important; }
    .text-gold { color: var(--accent-gold) !important; }
    .text-sub { color: var(--ink-sub) !important; }
    .text-ink { color: var(--ink) !important; }

    .bg-accent { background-color: var(--accent) !important; color: #0B0E14 !important; }
    .bg-danger { background-color: var(--accent-danger) !important; color: #0B0E14 !important; }
    .bg-success { background-color: var(--accent-success) !important; color: #0B0E14 !important; }
    .bg-gold { background-color: var(--accent-gold) !important; color: #0B0E14 !important; }
    .bg-panel { background-color: var(--panel) !important; color: var(--ink) !important; }

    .stroke-accent { border: 3px solid var(--accent) !important; }
    .stroke-danger { border: 3px solid var(--accent-danger) !important; }
    .stroke-success { border: 3px solid var(--accent-success) !important; }
    .stroke-sub { border: 3px solid #334155 !important; }

    /* Component Styles */
    .card-hero {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .panel-box {
      position: absolute;
      background-color: var(--panel);
      border-radius: var(--radius);
      border: 3px solid #1E293B;
    }

    .stat-box {
      position: absolute;
      left: 80px;
      right: 80px;
      background-color: var(--panel);
      border-radius: var(--radius);
      padding: 48px;
      text-align: center;
      border: 3px solid var(--accent);
    }

    .stat-number {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 108px;
      font-weight: 600;
      line-height: 1;
    }

    .stat-label {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      letter-spacing: 2px;
      color: var(--ink-sub);
      margin-top: 16px;
    }

    .badge-tag {
      display: inline-block;
      padding: 12px 28px;
      border-radius: 999px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      letter-spacing: 1px;
    }

    .stamp-alert {
      position: absolute;
      left: 80px;
      right: 80px;
      padding: 32px 40px;
      border: 10px double var(--accent-danger);
      border-radius: var(--radius);
      font-family: 'IBM Plex Mono', monospace;
      font-size: 52px;
      font-weight: 600;
      text-align: center;
      color: var(--accent-danger);
      transform: rotate(-3deg);
    }

    .pulse-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background-color: var(--accent);
      display: inline-block;
    }

    .diagram-box {
      position: absolute;
      left: 80px;
      right: 80px;
      width: 920px;
    }

    .svg-canvas {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    .svg-text-bold {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-weight: 900;
      font-size: 36px;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    .svg-text-mono {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 600;
      font-size: 28px;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    .svg-text-small {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 400;
      font-size: 22px;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    .node-panel {
      fill: #121722;
      stroke-width: 4;
    }

    .branch-list {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .branch-card {
      display: flex;
      align-items: center;
      gap: 32px;
      padding: 36px 40px;
      background-color: var(--panel);
      border-radius: var(--radius);
    }

    .branch-num {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 64px;
      font-weight: 600;
      color: var(--accent);
    }

    .branch-name {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 42px;
      font-weight: 900;
    }

    .branch-desc {
      font-size: 32px;
      color: var(--ink-sub);
      margin-top: 4px;
    }

    .grid-pairs {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .pair-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 36px 40px;
      background-color: var(--panel);
      border-radius: var(--radius);
      border: 3px solid #1E293B;
    }

    .pair-input {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 38px;
      font-weight: 600;
    }

    .pair-arrow {
      font-size: 40px;
      color: var(--accent);
    }

    .pair-label {
      padding: 12px 28px;
      border-radius: 12px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
    }

    .step-list {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .step-item {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 32px 36px;
      background-color: var(--panel);
      border-radius: var(--radius);
      border: 3px solid #1E293B;
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 38px;
      font-weight: 900;
    }

    .step-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 60px;
      height: 60px;
      border-radius: 16px;
      background-color: var(--accent);
      color: #0B0E14;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .card-quote {
      position: absolute;
      left: 80px;
      right: 80px;
      background-color: var(--panel);
      border-radius: var(--radius);
      padding: 48px;
      border-left: 12px solid var(--accent);
    }

    .quote-text {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 44px;
      font-weight: 600;
      line-height: 1.45;
      color: var(--ink);
    }

    .author-name {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 38px;
      font-weight: 900;
      color: var(--accent);
    }

    .author-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 28px;
      color: var(--ink-sub);
      margin-top: 4px;
    }

    .caption-tip {
      position: absolute;
      left: 80px;
      right: 80px;
      padding: 28px 36px;
      background-color: #1E293B;
      border-radius: 16px;
      font-size: 34px;
      font-weight: 600;
      color: #93C5FD;
    }

    .accuracy-gauge {
      position: absolute;
      left: 80px;
      right: 80px;
      background-color: var(--panel);
      border-radius: var(--radius);
      padding: 56px 48px;
      text-align: center;
      border: 3px solid var(--accent);
    }

    .gauge-label {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      letter-spacing: 4px;
      color: var(--ink-sub);
    }

    .gauge-number {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 130px;
      font-weight: 600;
      margin-top: 16px;
    }

    .progress-bar-bg {
      width: 100%;
      height: 28px;
      background-color: #1E293B;
      border-radius: 14px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background-color: var(--accent);
      border-radius: 14px;
    }

    .grid-2col {
      display: flex;
      align-items: center;
      justify-content: space-around;
      gap: 32px;
    }

    .grid-3col {
      position: absolute;
      left: 80px;
      right: 80px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .col-card {
      padding: 32px 36px;
      background-color: var(--panel);
      border-radius: var(--radius);
    }

    .col-title {
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 38px;
      font-weight: 900;
    }

    .col-desc {
      font-size: 30px;
      color: var(--ink-sub);
      margin-top: 6px;
    }

    .grid-2col-cards {
      position: absolute;
      left: 80px;
      right: 80px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }

    .app-card {
      padding: 44px 32px;
      background-color: var(--panel);
      border-radius: var(--radius);
      border: 3px solid #1E293B;
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 34px;
      font-weight: 900;
      text-align: center;
    }

    .split-bar-box {
      position: absolute;
      left: 80px;
      right: 80px;
      display: flex;
      height: 100px;
      border-radius: var(--radius);
      overflow: hidden;
    }

    .split-segment {
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      color: #0B0E14;
    }

    .kfold-diagram {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .kfold-row {
      display: flex;
      gap: 12px;
      height: 70px;
    }

    .fold-seg {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 26px;
      font-weight: 600;
      color: #0B0E14;
    }

    .confusion-matrix {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .cm-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    .cm-cell {
      padding: 48px 24px;
      border-radius: var(--radius);
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      font-weight: 600;
      text-align: center;
      color: #0B0E14;
    }

    .badge-list {
      position: absolute;
      left: 80px;
      right: 80px;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .badge-list-lg {
      position: absolute;
      left: 80px;
      right: 80px;
    }

    .badge-card {
      padding: 36px 40px;
      background-color: var(--panel);
      border-radius: var(--radius);
      font-family: 'Be Vietnam Pro', sans-serif;
      font-size: 42px;
      font-weight: 900;
    }

    .matrix-box {
      position: absolute;
      left: 80px;
      right: 80px;
      background-color: #05070A;
      border: 3px solid #1E293B;
      border-radius: var(--radius);
      padding: 36px 40px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 28px;
      line-height: 1.8;
    }

    /* Karaoke Captions */
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
      z-index: 90;
    }

    .cw {
      font-size: 54px;
      font-weight: 700;
      color: var(--caption-idle);
    }
  </style>
  <script src="gsap.min.js"></script>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${totalDuration}">
    
    <!-- Audio Master Track -->
    <audio id="vo-master" src="voice/narration.wav" data-start="0.00" data-volume="1"></audio>

    <!-- Scenes for 52 beats -->
${sceneClipsHtml}

    <!-- Karaoke Captions Layer -->
${captionsClipsHtml}

  </div>

  <script>
    // Initialize GSAP paused timeline
    const tl = gsap.timeline({ paused: true });
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = tl;

    // Scene transition fades
${sceneAnimJs}

    // Karaoke word-level highlighting
    const CAPTION_ACTIVE = "#60A5FA";
    const CAPTION_IDLE = "rgba(244, 247, 251, 0.45)";
    const cwNodes = document.querySelectorAll(".caption-line .cw");
    const CAPTION_WORDS = ${JSON.stringify(captionsData.wordData)};

    CAPTION_WORDS.forEach(([lineIdx, wordIdx, start, end], k) => {
      const el = cwNodes[k];
      if (!el) return;
      tl.set(el, { color: CAPTION_ACTIVE }, start);
      tl.set(el, { color: CAPTION_IDLE }, end);
    });
  </script>
</body>
</html>
`;

writeFileSync(join(targetDir, "index.html"), indexHtml, "utf-8");
console.log(`Successfully built index.html for ${slug} (${beats.beats.length} beats, ${totalDuration}s)`);
