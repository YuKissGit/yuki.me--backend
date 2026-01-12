//1. import------------------------------------
const{escapeHTML,sendJSON} = require('./util');

//read .env file, load from .env to process.env (for node.js)
require('dotenv').config(); 

//load module from node.js
const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

const uri = process.env.MONGO_URI; //Reads database connection string from environment variables.
const port = process.env.PORT || 3000; //Uses the platform’s port if provided, otherwise defaults to 3000.

//2. Database MongoClient setup--------------------
const client = new MongoClient(uri);

//Declares a variable to store the comments collection
let commentsCollection;

//database configure
async function connectDB() {
  await client.connect(); //MongoDB: client → database → collection → documents
  const db = client.db('myDatabase'); // the database name on Atlas
  commentsCollection = db.collection('comments');
  console.log('Connected to MongoDB Atlas');
}

//3. safety configure (optional)--------------------------------
// IP rate
const rateLimitMap = new Map();
const RATE_LIMIT = 5; 
const WINDOW_MS = 60 * 1000; //one minute

//4. Defines which frontend domains are allowed to access this backend---
const allowedOrigins = ['https://yukime.vercel.app/']; //here we can add more, like mobile domain

//5. HTTP Server configure-------------------------------
const server = http.createServer(async (req, res) => {

  //5.1 instantly get current domain
  const origin = req.headers.origin;

  //5.2 check if domain is required
  // CORS ：Cross-Origin Resource Sharing
  if (origin && allowedOrigins.includes(origin)) { //there may be multiple domain, but here I only have one 'https://yukime.vercel.app/'
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  //5.3 pre-require from browser, if no pre-require will fail
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  //business features---------------------------

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

// 6. start server --------------------
//server listen after connecting DB successfully 
connectDB()
  .then(() => {
    server.listen(port, () => console.log(`Server running at ${port}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB', err);
  });
