// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure folders/files exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DATA_FILE))
  fs.writeFileSync(DATA_FILE, JSON.stringify({ reports: [] }, null, 2));

const app = express();
app.disable('etag');
app.use(cors());
app.use(bodyParser.json());

// API 응답은 항상 최신 데이터를 주도록 캐싱 방지 헤더 설정
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  return next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Multer config for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ok =
      allowed.test(file.mimetype) ||
      allowed.test(path.extname(file.originalname).toLowerCase());
    if (!ok) {
      return cb(new Error('지원하지 않는 파일 형식입니다.'));
    }
    cb(null, true);
  },
});

// Helper functions to read/write DB
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('❌ DB 읽기 실패:', e);
    return { reports: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ DB 쓰기 실패:', e);
  }
}

/**
 * POST /api/report
 * fields: description (string), lat (number, optional), lng (number, optional)
 * file: photo (optional)
 */
app.post('/api/report', (req, res, next) => {
  // multer 실행을 try/catch로 감싸서 파일 업로드 중 에러도 캐치
  upload.single('photo')(req, res, function (err) {
    try {
      if (err) {
        console.error('❌ Multer error:', err);
        return res.status(400).json({
          success: false,
          error: '파일 업로드 실패',
          detail: err.message,
        });
      }

      const { description, lat, lng } = req.body;

      // Basic validation
      if ((!description || description.trim().length < 3) && !req.file) {
        return res.status(400).json({
          success: false,
          error: '설명 또는 사진 중 하나는 필요합니다.',
        });
      }

      // DB 읽기
      const db = readDB();

      // 새로운 신고 객체
      const report = {
        id: nanoid(10),
        description: description ? description.trim() : '',
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        photo: req.file ? `/uploads/${path.basename(req.file.path)}` : null,
        createdAt: new Date().toISOString(),
        resolved: false,
      };

      // DB에 추가
      db.reports.unshift(report);
      writeDB(db);

      // ✅ 항상 JSON으로 응답
      return res.status(200).json({ success: true, report });
    } catch (error) {
      console.error('❌ /api/report error:', error);
      return res.status(500).json({
        success: false,
        error: '서버 내부 오류',
        detail: error.message,
      });
    }
  });
});

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));

// GET /api/reports - 리스트 반환
app.get('/api/reports', (req, res) => {
  const db = readDB();
  res.json({ reports: db.reports });
});

// POST /api/report/:id/toggle - 신고 해결 상태 토글
app.post('/api/report/:id/toggle', (req, res) => {
  const db = readDB();
  const id = req.params.id;
  const idx = db.reports.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: '찾을 수 없음' });

  db.reports[idx].resolved = !db.reports[idx].resolved;
  writeDB(db);
  res.json({ success: true, report: db.reports[idx] });
});

// Global error handler - ensures JSON 응답
app.use((err, req, res, next) => {
  console.error('❌ 요청 처리 중 오류:', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  const message =
    err.expose && err.message
      ? err.message
      : err.message || '서버 내부 오류가 발생했습니다.';
  res.status(status).json({
    success: false,
    error: message,
    detail: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
