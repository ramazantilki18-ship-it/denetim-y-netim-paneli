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

function updateDocument(path, fields, updateMaskFields) {
  return new Promise((resolve, reject) => {
    const query = updateMaskFields.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}?${query}`;
    
    const body = JSON.stringify({ fields });
    
    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Status ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseTime(doc) {
  const fields = doc.fields || {};
  const dStr = fields.date?.stringValue || fields.createdAt?.stringValue || fields.createdAt?.timestampValue || fields.date?.timestampValue;
  if (!dStr) return 0;
  return new Date(dStr).getTime() || 0;
}

async function run() {
  console.log('🚀 Migration starting...');
  
  // 1. Audits
  console.log('\n--- Migrating Audits ---');
  const auditDocs = await fetchCollection('audits');
  console.log(`Found ${auditDocs.length} audits.`);
  
  auditDocs.sort((a, b) => parseTime(a) - parseTime(b));
  
  let auditCounter = 0;
  for (const doc of auditDocs) {
    auditCounter++;
    const auditNo = `D-${auditCounter.toString().padStart(5, '0')}`;
    const nameParts = doc.name.split('/');
    const docId = nameParts[nameParts.length - 1];
    
    const existingAuditNo = doc.fields?.auditNo?.stringValue;
    if (existingAuditNo === auditNo) {
      console.log(`Audit ${docId} already has ${auditNo}`);
      continue;
    }
    
    console.log(`Updating Audit ${docId} -> ${auditNo}`);
    await updateDocument(`audits/${docId}`, {
      auditNo: { stringValue: auditNo }
    }, ['auditNo']);
  }
  
  // 2. Nonconformities
  console.log('\n--- Migrating Non-conformities ---');
  const ncDocs = await fetchCollection('nonconformities');
  console.log(`Found ${ncDocs.length} nonconformities.`);
  
  ncDocs.sort((a, b) => parseTime(a) - parseTime(b));
  
  let ncCounter = 0;
  for (const doc of ncDocs) {
    ncCounter++;
    const ncNo = `U-${ncCounter.toString().padStart(5, '0')}`;
    const nameParts = doc.name.split('/');
    const docId = nameParts[nameParts.length - 1];
    
    const existingNcNo = doc.fields?.ncNo?.stringValue;
    if (existingNcNo === ncNo) {
      console.log(`NC ${docId} already has ${ncNo}`);
      continue;
    }
    
    console.log(`Updating NC ${docId} -> ${ncNo}`);
    await updateDocument(`nonconformities/${docId}`, {
      ncNo: { stringValue: ncNo }
    }, ['ncNo']);
  }
  
  // 3. Update Counters
  console.log(`\nUpdating system_config/counters: lastAuditNumber=${auditCounter}, lastNcNumber=${ncCounter}`);
  await updateDocument('system_config/counters', {
    lastAuditNumber: { integerValue: auditCounter.toString() },
    lastNcNumber: { integerValue: ncCounter.toString() },
    updatedAt: { timestampValue: new Date().toISOString() }
  }, ['lastAuditNumber', 'lastNcNumber', 'updatedAt']);
  
  console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
