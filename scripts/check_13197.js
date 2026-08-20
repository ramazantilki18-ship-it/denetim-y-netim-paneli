const https = require('https');

const PROJECT_ID = 'fir-denetim-c6abc';

function fetchCollection(collectionName) {
  return new Promise((resolve, reject) => {
    let allDocs = [];
    function getPage(pageToken) {
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}?pageSize=300`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error('Firestore REST Error:', parsed.error);
            }
            if (parsed.documents) {
              allDocs = allDocs.concat(parsed.documents);
            }
            if (parsed.nextPageToken) {
              getPage(parsed.nextPageToken);
            } else {
              resolve(allDocs);
            }
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    }
    getPage();
  });
}

async function run() {
  try {
    console.log('Fetching audits...');
    const audits = await fetchCollection('audits');
    console.log(`Total audits: ${audits.length}`);
    const target = audits.find(doc => {
      const fields = doc.fields || {};
      const auditNo = fields.auditNo?.stringValue || '';
      return auditNo === 'D-13197' || doc.name.endsWith('13197') || auditNo.includes('13197');
    });
    
    if (!target) {
      console.log('Audit not found');
      return;
    }
    
    console.log('Found audit:');
    console.log(JSON.stringify(target, null, 2));
  } catch (e) {
    console.error(e);
  }
}

run();
