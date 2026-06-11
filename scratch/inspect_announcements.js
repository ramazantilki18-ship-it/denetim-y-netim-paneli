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
        const result = await getJSON('https://firestore.googleapis.com/v1/projects/fir-denetim-c6abc/databases/(default)/documents/announcements?pageSize=100');
        const documents = result.documents || [];
        const announcements = documents.map(doc => {
            const pathParts = doc.name.split('/');
            const docId = pathParts[pathParts.length - 1];
            const fields = doc.fields || {};
            
            return {
                docId,
                title: fields.title ? fields.title.stringValue : 'N/A',
                message: fields.message ? fields.message.stringValue : 'N/A',
                startAt: fields.startAt ? fields.startAt.timestampValue : 'N/A',
                endAt: fields.endAt ? fields.endAt.timestampValue : 'N/A',
                isActive: fields.isActive ? fields.isActive.booleanValue : 'N/A',
                rawFields: fields
            };
        });
        
        console.log(JSON.stringify(announcements, null, 2));
    } catch (e) {
        console.error(e);
    }
}

main();
