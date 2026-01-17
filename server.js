//1. import------------------------------------
const{escapeHTML,sendJSON, buildTree} = require('./util');

//read .env file, load from .env to process.env (for node.js)
require('dotenv').config(); 

//load node.js modules
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
// const allowedOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500'];


//5. HTTP Server configure-------------------------------
const server = http.createServer(async (req, res) => {

  //5.1 instantly get current domain
  const origin = req.headers.origin;
  console.log('origin: ', origin);
  
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

  //business features================================================
  // -------get comment from DB--------
  //because only comment tab need back end to load and get comment, so other request handled by frontend

  // parse URL-----------
  // req.url maybe "/comments?page=1&limit=5"
  const baseURL =  `http://${req.headers.host}`;
  const parsedUrl = new URL(req.url, baseURL);
  const pathname = parsedUrl.pathname;

  // GET Comments -----------
  if (req.method === 'GET' && pathname === '/comments') {
    try {
      // 1. get setting from front end ??
      const page = parseInt(parsedUrl.searchParams.get('page')) || 1;
      const limit = parseInt(parsedUrl.searchParams.get('limit')) || 15;

      // 2. get all the data (this case data is not that big), so it loop again each req? how to jump newer and older?
      const allComments = await commentsCollection
        .find({})
        .sort({ createdAt: -1 }) //  -1 des
        .toArray();

      // 3. build tree cut tree
      const fullTree = buildTree(allComments);
      const totalRootComments = fullTree.length;
      const totalPages = Math.ceil(totalRootComments / limit);
    
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;

      // 4. current page data
      const paginatedComments = fullTree.slice(startIndex, endIndex);

      // 6. return with current page comment
      sendJSON(res, 200, {
        comments: paginatedComments,
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalRootComments
      });

    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: 'Database error in server.js file' });
    }
    return;
  }

 // ---------submit comments-----------
  if (req.method === 'POST' && pathname === '/comments') {

    //1.get data first
    let body = '';
    req.on('data', chunk => {//chunk is buffer send each time
      body += chunk;

      // 1. HTTP request start (single POST request)
      // 2. TCP layer splits request into multiple packets
      // 3. Node.js 'data' events triggered multiple times (each chunk of the body)
      // 4. TCP finishes sending all packets
      // 5. Node.js 'end' event triggered (full request body received)
      // 6. HTTP request ends (Node now has complete data)
      if (body.length > 1e6) { // if >1MB.  /// body is single package, not entire data
        req.socket.destroy(); // end the req
      }
    });

    //2.validate and save data
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { name, email, content, parentId,website } = data;

        //2-1.honeypot anti-spam --------------
        if (website) { //website is a hidden field, bots usually auto-fill all form fields.
          return sendJSON(res, 200, { success: true }); //Fake success response
        }
        //2-2. required field check -----------
        if (!name || !email || !content) {
          return sendJSON(res, 400, { success: false, message: 'Missing fields' });
        }
        //2-3. data length --------------------
        if (name.length > 50 || email.length > 50 || content.length > 500) {
          return sendJSON(res, 400, { success: false, message: 'Field too long' });
        }
        //2-4. submit rate--------------------
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        let entry = rateLimitMap.get(ip) || [];
        entry = entry.filter(ts => now - ts < WINDOW_MS);
        if (entry.length >= RATE_LIMIT) {
          return sendJSON(res, 429, { success: false, message: 'Too many requests, try later' });
        }
        entry.push(now);
        rateLimitMap.set(ip, entry);

        //2-5. XSS：Cross-Site Scripting escaping--------------------
        const safeComment = {
          name: escapeHTML(name),
          email: escapeHTML(email),
          content: escapeHTML(content),
          parentId: parentId ? new ObjectId(parentId) : null,
          createdAt: new Date(),
          ip
        };

        //insert validated data into DB
        await commentsCollection.insertOne(safeComment);

        sendJSON(res, 200, { success: true, message: 'Comment saved' });

      } catch (err) {
        console.error(err);
        sendJSON(res, 400, { success: false, message: 'Invalid JSON or server error' });
      }
    });
    //3. return
    return;
  }

//----------------count snow----------------------
  //1. get current num from DB
  if (req.method === 'GET' && pathname === '/api/snow-clicks') {
    try {
      const db = client.db('myDatabase'); 
      const countersCollection = db.collection('counters');

      const counter = await countersCollection.findOne({ name: 'snow_clicks' });
      const count = counter ? counter.count : 0;
      
      sendJSON(res, 200, { count: count });
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: 'Failed to fetch clicks' });
    }
    return;
  }

  // 2. add num
  if (req.method === 'POST' && pathname === '/api/snow-clicks') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const incrementBy = data.incrementBy || 1; //get increment from front end

        const db = client.db('myDatabase');
        const countersCollection = db.collection('counters');

        // updata to DB
        const result = await countersCollection.findOneAndUpdate(
          { name: 'snow_clicks' },
          { $inc: { count: incrementBy } },
          { returnDocument: 'after', upsert: true } 
        );

        const newCount = result ? result.count : 0; //MongoDB return value type is different across versions
        
        sendJSON(res, 200, { success: true, count: newCount });
      } catch (err) {
        console.error(err);
        sendJSON(res, 500, { error: 'Update failed' });
      }
    });
    return;
  }


  // -------------404 --------------------
  res.writeHead(404);
  res.end('Not Found');
});

// 6. start server --------------------
//server start to listen after connecting DB successfully 
connectDB()
  .then(() => {
    server.listen(port, () => console.log(`Server running at ${port}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB', err);
  });


