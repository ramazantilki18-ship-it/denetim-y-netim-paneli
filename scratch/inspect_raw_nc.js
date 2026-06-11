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
        const result = await getJSON('https://firestore.googleapis.com/v1/projects/fir-denetim-c6abc/databases/(default)/documents/nonconformities?pageSize=3');
        const documents = result.documents || [];
        console.log(JSON.stringify(documents, null, 2));
    } catch (e) {
        console.error(e);
    }
}

main();
