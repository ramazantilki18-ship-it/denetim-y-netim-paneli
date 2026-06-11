const https = require('https');

function getJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    try {
        const result = await getJSON('https://firestore.googleapis.com/v1/projects/fir-denetim-c6abc/databases/(default)/documents/nonconformities?pageSize=100');
        const documents = result.documents || [];
        const ncs = documents.map(doc => {
            const pathParts = doc.name.split('/');
            const docId = pathParts[pathParts.length - 1];
            const fields = doc.fields || {};
            const line = fields.line ? fields.line.stringValue : 'N/A';
            const station = fields.station ? fields.station.stringValue : 'N/A';
            const auditId = fields.auditId ? fields.auditId.stringValue : 'N/A';
            const status = fields.status ? fields.status.stringValue : 'N/A';
            
            return { docId, line, station, auditId, status };
        });
        
        console.log(JSON.stringify(ncs, null, 2));
    } catch (e) {
        console.error(e);
    }
}

main();
