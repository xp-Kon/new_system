// 公告系统后端 API 服务器
const express = require('express');
const cors = require('cors');
const db = require('./db');

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xss = require('xss');

const app = express();

// 启用跨域，支持前端域名访问
app.use(cors());
// 支持大文本（富文本内容），限制10MB
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 统一响应格式：code=0 表示成功
function ok(res, data) {
  res.json({ code: 0, msg: 'ok', data });
}
// 错误响应：code=1 表示失败
function bad(res, msg) {
  res.status(400).json({ code: 1, msg });
}

// XSS 过滤：防止富文本中的恶意脚本
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return xss(input.trim());
}

// 标题验证：必填，最大255字符
function validateTitle(title) {
  if (!title) return 'Title is required';
  if (title.length > 255) return 'Title is too long (max 255 characters)';
  return null;
}

// 内容验证：必填，最大50000字符
function validateContent(content) {
  if (!content) return 'Content is required';
  if (content.length > 50000) return 'Content is too long (max 50000 characters)';
  return null;
}

// ID 验证：必须为正整数
function validateId(id) {
  const numId = Number(id);
  if (!numId || numId <= 0) return 'Invalid ID';
  return null;
}

// ========== 文件上传配置 ==========
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create upload directory:', err);
  }
}

// 允许的图片格式
const allowedFileTypes = /jpeg|jpg|png|gif/;
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedFileTypes.test(ext)) {
    return cb(new Error('Invalid file type. Only jpeg, jpg, png, and gif files are allowed.'), false);
  }
  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedFileTypes.test(ext)) {
      return cb(new Error('Invalid file type. Only jpeg, jpg, png, and gif files are allowed.'), false);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // 使用时间戳+随机字符串命名，避免文件名冲突
    const sanitizedName = Date.now() + '_' + Math.random().toString(16).slice(2) + ext;
    cb(null, sanitizedName);
  }
});
// 限制单个文件最大5MB
const uploader = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// 静态资源服务：图片可通过 URL 直接访问
app.use('/uploads', express.static(uploadDir));

// ========== 图片上传接口 ==========
// 前端使用 uni.uploadFile，name 固定为 'file'
app.post('/api/upload', uploader.single('file'), (req, res, next) => {
  if (req.fileValidationError) {
    return bad(res, req.fileValidationError);
  }
  
  if (!req.file) {
    return bad(res, 'File upload failed or invalid file type');
  }
  
  const ext = path.extname(req.file.filename).toLowerCase();
  if (!allowedFileTypes.test(ext)) {
    fs.unlink(path.join(uploadDir, req.file.filename), (err) => {
      console.error('Invalid file was uploaded and deleted:', err);
    });
    return bad(res, 'Invalid file type. Only jpeg, jpg, png, and gif files are allowed.');
  }
  
  const host = req.headers.host;
  const url = `http://${host}/uploads/${req.file.filename}`;
  ok(res, { url });
});

// ========== Multer 错误处理中间件 ==========
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return bad(res, 'File too large. Maximum size is 5MB.');
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return bad(res, 'Too many files. Only one file allowed.');
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return bad(res, 'Unexpected field name for file upload.');
    }
    return bad(res, error.message);
  }
  next(error);
});

// ========== 公告 API 接口 ==========

// GET /api/notices - 获取公告列表（分页，支持按状态筛选）
app.get('/api/notices', async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const size = Number(req.query.size || 10);
    const status = (req.query.status || '').trim();

    if (page <= 0 || size <= 0 || size > 100) return bad(res, 'page/size invalid');
    if (status && !['draft', 'published'].includes(status)) return bad(res, 'invalid status');

    const offset = (page - 1) * size;
    let whereSql = '';
    let args = [];
    if (status) {
      whereSql = 'WHERE status=?';
      args.push(status);
    }

    const [rows] = await db.query(
      `SELECT id,title,content,status,publish_time,created_at,updated_at
       FROM notice ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, size, offset]
    );

    const [cnt] = await db.query(
      `SELECT COUNT(*) AS total FROM notice ${whereSql}`,
      args
    );

    ok(res, { list: rows, total: cnt[0].total, page, size });
  } catch (e) {
    console.error('Error in /api/notices GET:', e);
    next(e);
  }
});

// GET /api/notices/:id - 获取单条公告详情
app.get('/api/notices/:id', async (req, res, next) => {
  try {
    const validationError = validateId(req.params.id);
    if (validationError) return bad(res, validationError);

    const id = Number(req.params.id);

    const [rows] = await db.query(
      'SELECT id,title,content,content_delta,status,publish_time,created_at,updated_at FROM notice WHERE id=?',
      [id]
    );
    if (!rows.length) return bad(res, 'not found');

    ok(res, rows[0]);
  } catch (e) {
    console.error('Error in /api/notices/:id GET:', e);
    next(e);
  }
});

// POST /api/notices - 创建新公告（默认状态为草稿）
app.post('/api/notices', async (req, res, next) => {
  try {
    const title = sanitizeInput(req.body.title);
    const content = sanitizeInput(req.body.content);
    const content_delta = req.body.content_delta ? String(req.body.content_delta) : null;

    const titleError = validateTitle(title);
    if (titleError) return bad(res, titleError);
    
    const contentError = validateContent(content);
    if (contentError) return bad(res, contentError);

    const [ret] = await db.query(
      "INSERT INTO notice(title,content,content_delta,status) VALUES(?,?,?, 'draft')",
      [title, content, content_delta]
    );

    ok(res, { id: ret.insertId });
  } catch (e) {
    console.error('Error in /api/notices POST:', e);
    next(e);
  }
});

// PUT /api/notices/:id - 修改公告（标题和内容）
app.put('/api/notices/:id', async (req, res, next) => {
  try {
    const validationError = validateId(req.params.id);
    if (validationError) return bad(res, validationError);
    
    const id = Number(req.params.id);

    const title = sanitizeInput(req.body.title);
    const content = sanitizeInput(req.body.content);
    const content_delta = req.body.content_delta ? String(req.body.content_delta) : null;

    const titleError = validateTitle(title);
    if (titleError) return bad(res, titleError);
    
    const contentError = validateContent(content);
    if (contentError) return bad(res, contentError);

    await db.query(
      'UPDATE notice SET title=?, content=?, content_delta=? WHERE id=?',
      [title, content, content_delta, id]
    );

    ok(res, true);
  } catch (e) {
    console.error('Error in /api/notices/:id PUT:', e);
    next(e);
  }
});

// POST /api/notices/:id/publish - 发布公告（修改状态和发布时间）
app.post('/api/notices/:id/publish', async (req, res, next) => {
  try {
    const validationError = validateId(req.params.id);
    if (validationError) return bad(res, validationError);

    const id = Number(req.params.id);

    await db.query(
      "UPDATE notice SET status='published', publish_time=NOW() WHERE id=?",
      [id]
    );

    ok(res, true);
  } catch (e) {
    console.error('Error in /api/notices/:id/publish POST:', e);
    next(e);
  }
});

// DELETE /api/notices/:id - 删除公告
app.delete('/api/notices/:id', async (req, res, next) => {
  try {
    const validationError = validateId(req.params.id);
    if (validationError) return bad(res, validationError);

    const id = Number(req.params.id);

    await db.query('DELETE FROM notice WHERE id=?', [id]);
    ok(res, true);
  } catch (e) {
    console.error('Error in /api/notices/:id DELETE:', e);
    next(e);
  }
});

// POST /api/notices/batch_delete - 批量删除公告
app.post('/api/notices/batch_delete', async (req, res, next) => {
  try {
    const ids = req.body.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) return bad(res, 'ids required');

    const safeIds = ids.map(n => Number(n)).filter(n => n > 0);
    if (!safeIds.length) return bad(res, 'ids invalid');
    
    if (safeIds.length > 100) return bad(res, 'Too many IDs in batch operation (max 100)');

    const inSql = safeIds.map(() => '?').join(',');
    await db.query(`DELETE FROM notice WHERE id IN (${inSql})`, safeIds);

    ok(res, true);
  } catch (e) {
    console.error('Error in /api/notices/batch_delete POST:', e);
    next(e);
  }
});

// ========== 错误处理 ==========
app.use((req, res, next) => {
  res.status(404).json({ code: 1, msg: 'not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ code: 1, msg: 'server error' });
});

// 启动服务器
app.listen(3000, () => {
  console.log('api on http://localhost:3000');
});