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

module.exports = {
  escapeHTML,
  sendJSON
}