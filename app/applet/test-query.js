import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp({
  projectId: config.firebase.projectId,
});
const db = getFirestore(app);
async function run() {
  const p = await getDocs(collection(db, 'projects'));
  p.forEach(doc => {
      console.log('Project:', doc.id, doc.data().name);
      console.log('Periods', doc.data().reportingPeriods);
  });
  console.log('done');
  process.exit(0);
}
run();
