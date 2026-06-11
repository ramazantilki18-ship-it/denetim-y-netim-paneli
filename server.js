const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
};

const server = http.createServer((req, res) => {
    // URL decoding to support spaces in file paths
    let cleanUrl = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(__dirname, cleanUrl);

    // Default route
    if (cleanUrl === '/' || cleanUrl === '') {
        filePath = path.join(__dirname, 'denetim_admin', 'index.html');
    }

    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    // Try serving denetim_admin/index.html for general SPA routes if any
                    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>404 Dosya Bulunamadı</h1><p>İstenen dosya bulunamadı.</p>', 'utf-8');
                } else {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(`Sunucu Hatası: ${err.code}`);
                }
            } else {
                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                res.writeHead(200, { 
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store'
                });
                res.end(content, 'utf-8');
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`[OK] Yerel web sunucusu başlatıldı!`);
    console.log(`👉 http://localhost:${PORT}/denetim_admin/index.html`);
});
