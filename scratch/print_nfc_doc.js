const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://firestore.googleapis.com/v1/projects/fir-denetim-c6abc/databases/(default)/documents/system_config/lines_stations';

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            const output = {
                fieldsPresent: Object.keys(json.fields || {}),
                stationNfcs: json.fields?.stationNfcs || 'NOT_PRESENT'
            };
            fs.writeFileSync(path.join(__dirname, 'nfc_check_output.json'), JSON.stringify(output, null, 2));
            console.log('Successfully written nfc_check_output.json');
        } catch (e) {
            console.error('Parse error:', e);
            fs.writeFileSync(path.join(__dirname, 'nfc_check_output.json'), data);
        }
    });
}).on('error', (err) => {
    console.error('Fetch error:', err);
});
