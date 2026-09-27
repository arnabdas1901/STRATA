const http = require('http');
http.get('http://localhost:3000/js/modules/equity.js', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('File size:', data.length));
});
