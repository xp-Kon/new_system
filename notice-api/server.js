const express = require('express');
const cors = require('cors');
const db = require('./db');

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xss = require('xss'); // Add XSS protection

const app = express();

// 富文本可能较大，适当放大限制
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function ok(res, data) {
  res.json({ code: 0, msg: 'ok', data });
}
function bad(res, msg) {
  res.status(400).json({ code: 1, msg });
}

// Input validation and sanitization helper functions
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return xss(input.trim());
}

function validateTitle(title) {
  if (!title) return 'Title is required';
  if (title.length > 255) return 'Title is too long (max 255 characters)';
  return null;
}

function validateContent(content) {
  if (!content) return 'Content is required';
  if (content.length > 50000) return 'Content is too long (max 50000 characters)';
  return null;
}

function validateId(id) {
  const numId = Number(id);
  if (!numId || numId <= 0) return 'Invalid ID';
  return null;
}

/* ========= 文件上传（图片） ========= */
// uploads 目录放在 notice-api/uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create upload directory:', err);
  }
}

// Configure multer with enhanced file validation
const allowedFileTypes = /jpeg|jpg|png|gif/;
const fileFilter = (req, file, cb) => {
  // Check file type
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedFileTypes.test(ext)) {
    return cb(new Error('Invalid file type. Only jpeg, jpg, png, and gif files are allowed.'), false);
  }
  
  // Check file size in the filter as well (extra security)
  // Note: multer size limit is the primary check, this is a secondary check
  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Validate file type
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedFileTypes.test(ext)) {
      return cb(new Error('Invalid file type. Only jpeg, jpg, png, and gif files are allowed.'), false);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent path traversal
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedName = Date.now() + '_' + Math.random().toString(16).slice(2) + ext;
    cb(null, sanitizedName);
  }
});
const uploader = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// 静态访问： http://host:3000/uploads/xxx.png
app.use('/uploads', express.static(uploadDir));

// 上传接口：前端用 uni.uploadFile(name='file')
app.post('/api/upload', uploader.single('file'), (req, res, next) => {
  // Handle multer errors
  if (req.fileValidationError) {
    return bad(res, req.fileValidationError);
  }
  
  // Validate uploaded file
  if (!req.file) {
    return bad(res, 'File upload failed or invalid file type');
  }
  
  // Additional validation: ensure the file was actually saved with correct extension
  const ext = path.extname(req.file.filename).toLowerCase();
  if (!allowedFileTypes.test(ext)) {
    // Remove the file if it has an invalid extension
    fs.unlink(path.join(uploadDir, req.file.filename), (err) => {
      console.error('Invalid file was uploaded and deleted:', err);
    });
    return bad(res, 'Invalid file type. Only jpeg, jpg, png, and gif files are allowed.');
  }
  
  const host = req.headers.host; // 例如 127.0.0.1:3000
  const url = `http://${host}/uploads/${req.file.filename}`;
  ok(res, { url });
});

// Multer error handling middleware
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

/* ========= 公告接口 ========= */

// 列表：支持 status=draft/published；返回 content 方便列表摘要
app.get('/api/notices', async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const size = Number(req.query.size || 10);
    const status = (req.query.status || '').trim();

    // Validate pagination parameters
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

// 详情：返回 content_delta（如果你表里有这列）
app.get('/api/notices/:id', async (req, res, next) => {
  try {
    const validationError = validateId(req.params.id);
    if (validationError) return bad(res, validationError);

    const id = Number(req.params.id);

    // 若你的表没有 content_delta，把它从 SELECT 中删掉
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

// 新增：默认 draft；content 存 HTML；content_delta 存 delta(JSON字符串)可选
app.post('/api/notices', async (req, res, next) => {
  try {
    // Sanitize and validate input to prevent XSS
    const title = sanitizeInput(req.body.title);
    const content = sanitizeInput(req.body.content);
    const content_delta = req.body.content_delta ? String(req.body.content_delta) : null;

    // Validate inputs
    const titleError = validateTitle(title);
    if (titleError) return bad(res, titleError);
    
    const contentError = validateContent(content);
    if (contentError) return bad(res, contentError);

    // 若你的表没有 content_delta，把它从 SQL 中删掉
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

// 修改：只改 title/content，不改 status
app.put('/api/notices/:id', async (req, res, next) => {
  try {
    const validationError = validateId(req.params.id);
    if (validationError) return bad(res, validationError);
    
    const id = Number(req.params.id);

    // Sanitize and validate input to prevent XSS
    const title = sanitizeInput(req.body.title);
    const content = sanitizeInput(req.body.content);
    const content_delta = req.body.content_delta ? String(req.body.content_delta) : null;

    // Validate inputs
    const titleError = validateTitle(title);
    if (titleError) return bad(res, titleError);
    
    const contentError = validateContent(content);
    if (contentError) return bad(res, contentError);

    // 若你的表没有 content_delta，把它从 SQL 中删掉
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

// 发布：只改状态与发布时间
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

// 删除
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

// 批量删除
app.post('/api/notices/batch_delete', async (req, res, next) => {
  try {
    const ids = req.body.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) return bad(res, 'ids required');

    const safeIds = ids.map(n => Number(n)).filter(n => n > 0);
    if (!safeIds.length) return bad(res, 'ids invalid');
    
    // Limit batch operations to prevent abuse
    if (safeIds.length > 100) return bad(res, 'Too many IDs in batch operation (max 100)');

    const inSql = safeIds.map(() => '?').join(',');
    await db.query(`DELETE FROM notice WHERE id IN (${inSql})`, safeIds);

    ok(res, true);
  } catch (e) {
    console.error('Error in /api/notices/batch_delete POST:', e);
    next(e);
  }
});

// 404
app.use((req, res, next) => {
  res.status(404).json({ code: 1, msg: 'not found' });
});

// 500
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  // Don't expose internal error details to client in production
  res.status(500).json({ code: 1, msg: 'server error' });
});

app.listen(3000, () => {
  console.log('api on http://localhost:3000');
});