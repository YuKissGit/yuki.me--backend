require('dotenv').config(); // 读取 .env 文件

const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

const uri = process.env.MONGO_URI;
const port = process.env.PORT || 3000;

// 创建 MongoClient 实例
const client = new MongoClient(uri);

let commentsCollection;

// 连接数据库
async function connectDB() {
  await client.connect();
  const db = client.db('myDatabase'); // 你 Atlas 里选择的数据库名
  commentsCollection = db.collection('comments');
  console.log('Connected to MongoDB Atlas');
}

// -------------------- 安全相关配置 --------------------

// 允许的前端域名
const allowedOrigins = ['http://127.0.0.1:5500']; // 改成你前端域名

// IP 速率限制
const rateLimitMap = new Map();
const RATE_LIMIT = 5; // 每分钟最多提交 5 条评论
const WINDOW_MS = 60 * 1000; // 1 分钟

// XSS 转义函数
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

// 发送 JSON 响应
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// -------------------- HTTP Server --------------------
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  // -------------------- CORS --------------------
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // -------------------- 静态文件 --------------------
  if (req.method === 'GET' && (req.url === '/' || req.url.endsWith('.html'))) {
    const filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  }

  // -------------------- 获取评论 --------------------
  if (req.method === 'GET' && req.url === '/comments') {
    try {
      const comments = await commentsCollection.find({}).sort({ createdAt: -1 }).toArray();
      sendJSON(res, 200, comments);
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: 'DB error' });
    }
    return;
  }

  // -------------------- 提交评论 --------------------
  if (req.method === 'POST' && req.url === '/comments') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 限制最大 1MB
        req.socket.destroy(); // 超过限制直接断开
      }
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { name, email, content, website } = data;

        // -------------------- honeypot 防垃圾 --------------------
        if (website) {
          return sendJSON(res, 200, { success: true }); // 隐蔽处理
        }

        // -------------------- 必填字段检查 --------------------
        if (!name || !email || !content) {
          return sendJSON(res, 400, { success: false, message: 'Missing fields' });
        }

        // -------------------- 数据长度限制 --------------------
        if (name.length > 50 || email.length > 50 || content.length > 500) {
          return sendJSON(res, 400, { success: false, message: 'Field too long' });
        }

        // -------------------- 速率限制 --------------------
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        let entry = rateLimitMap.get(ip) || [];
        entry = entry.filter(ts => now - ts < WINDOW_MS);
        if (entry.length >= RATE_LIMIT) {
          return sendJSON(res, 429, { success: false, message: 'Too many requests, try later' });
        }
        entry.push(now);
        rateLimitMap.set(ip, entry);

        // -------------------- XSS 转义 --------------------
        const safeComment = {
          name: escapeHTML(name),
          email: escapeHTML(email),
          content: escapeHTML(content),
          createdAt: new Date(),
          ip
        };

        // 插入数据库
        await commentsCollection.insertOne(safeComment);

        sendJSON(res, 200, { success: true, message: 'Comment saved' });

      } catch (err) {
        console.error(err);
        sendJSON(res, 400, { success: false, message: 'Invalid JSON or server error' });
      }
    });
    return;
  }

  // -------------------- 404 --------------------
  res.writeHead(404);
  res.end('Not Found');
});

// -------------------- 启动服务器 --------------------
connectDB()
  .then(() => {
    server.listen(port, () => console.log(`Server running at http://localhost:${port}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB', err);
  });
