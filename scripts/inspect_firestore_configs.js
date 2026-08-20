const firebase = require('firebase/compat/app');
require('firebase/compat/auth');
require('firebase/compat/firestore');

const firebaseConfig = {
    apiKey: 'AIzaSyA34MWjv-08j5T5hlMhGPV2HzZo9kSqY8g',
    authDomain: 'fir-denetim-c6abc.firebaseapp.com',
    projectId: 'fir-denetim-c6abc',
    storageBucket: 'fir-denetim-c6abc.firebasestorage.app',
    messagingSenderId: '1009095169052',
    appId: '1:1009095169052:web:ac551e94b618a222907bd9'
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

async function inspect() {
    try {
        console.log('Logging in with ramazan.tilki@metro.istanbul / 123456 or ramazan@test.com...');
        let userCred = null;
        try {
            userCred = await auth.signInWithEmailAndPassword('ramazan.tilki@metro.istanbul', '123456');
            console.log('Logged in as:', userCred.user.email);
        } catch (e) {
            console.log('Login 1 failed:', e.message);
            try {
                userCred = await auth.signInWithEmailAndPassword('ramazan@test.com', '123456');
                console.log('Logged in as:', userCred.user.email);
            } catch (e2) {
                console.log('Login 2 failed:', e2.message);
            }
        }

        console.log('Fetching system_config/permissions...');
        const permDoc = await db.collection('system_config').doc('permissions').get();
        console.log('system_config/permissions exists:', permDoc.exists);
        if (permDoc.exists) {
            console.log('permissions keys:', Object.keys(permDoc.data()));
        }

        console.log('Fetching system_config/mobile_permissions...');
        const mobPermDoc = await db.collection('system_config').doc('mobile_permissions').get();
        console.log('system_config/mobile_permissions exists:', mobPermDoc.exists);
        if (mobPermDoc.exists) {
            console.log('mobile_permissions data:', JSON.stringify(mobPermDoc.data(), null, 2));
        }

        console.log('Fetching shifts...');
        const shifts = await db.collection('shifts').get();
        console.log('shifts count:', shifts.size);
        shifts.forEach(s => {
            console.log('shift:', s.id, JSON.stringify(s.data()));
        });

        console.log('Fetching users...');
        const users = await db.collection('users').limit(5).get();
        console.log('users count in sample:', users.size);
        users.forEach(u => {
            console.log('user:', u.id, JSON.stringify(u.data()));
        });

        process.exit(0);
    } catch (e) {
        console.error('Inspection error:', e);
        process.exit(1);
    }
}

inspect();
