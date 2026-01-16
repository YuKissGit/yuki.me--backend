// XSS Converts dangerous characters into safe HTML entities.
function escapeHTML(str) {
         //string.replace(pattern（g -> global), replacement)
  return str.replace(/[&<>"']/g, m => ({ 
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
  //m => map[m]---------equal to
  //m => {
  //if (m === '<') return '&lt;';
  //if (m === '>') return '&gt;';}

}

//send responce as a JSON format
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}


function buildTree(comments) {
  const map = {};
  const roots = []; //root comment without parentID

  comments.forEach(c => {
    c.children = []; //give each comment an empty children array, each node can have child nodes.
    map[c._id] = c; // map comment id to the object reference in memory
  });

  comments.forEach(c => {
    if (c.parentId) {
      map[c.parentId]?.children.push(c); //use ? to avoid a TypeError if the parent does not exist
    } else {
      roots.push(c);
    }
  });

  return roots;
}


module.exports = {
  escapeHTML,
  sendJSON,
  buildTree
}