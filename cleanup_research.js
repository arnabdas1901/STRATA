const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

const removeRegex = /<a class="nav-item(?:\s+active)?" href="research\.html">[\s\S]*?<\/a>\s*/g;

let count = 0;
for (const file of files) {
    const filePath = path.join(publicDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    if (content.match(removeRegex)) {
        content = content.replace(removeRegex, '');
        fs.writeFileSync(filePath, content);
        count++;
    }
}

console.log(`Removed research.html link from ${count} HTML files.`);

// Also delete the file itself
try {
    fs.unlinkSync(path.join(publicDir, 'research.html'));
    console.log('Deleted research.html');
} catch (e) {
    console.log('research.html already deleted or error:', e.message);
}
