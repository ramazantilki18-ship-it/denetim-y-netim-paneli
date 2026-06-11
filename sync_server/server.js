const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        audits: [],
        nonconformities: [],
        tasks: [],
        users: []
    }, null, 2));
}

const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/api/data' && req.method === 'GET') {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
    } 
    else if (req.url === '/api/sync' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const newData = JSON.parse(body);
                const currentData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                
                // Simple merge logic: update or add items
                if (newData.audits) {
                    newData.audits.forEach(audit => {
                        const index = currentData.audits.findIndex(a => a.id === audit.id);
                        if (index !== -1) currentData.audits[index] = audit;
                        else currentData.audits.push(audit);
                    });
                }
                if (newData.nonconformities) {
                    newData.nonconformities.forEach(nc => {
                        const index = currentData.nonconformities.findIndex(n => n.id === nc.id);
                        if (index !== -1) currentData.nonconformities[index] = nc;
                        else currentData.nonconformities.push(nc);
                    });
                }
                if (newData.users) {
                    newData.users.forEach(user => {
                        const index = currentData.users.findIndex(u => u.id === user.id);
                        if (index !== -1) currentData.users[index] = user;
                        else currentData.users.push(user);
                    });
                }

                fs.writeFileSync(DATA_FILE, JSON.stringify(currentData, null, 2));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', message: 'Data synced' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: e.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`Sync server running at http://localhost:${PORT}`);
});
