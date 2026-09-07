import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp({
  projectId: config.firebase.projectId,
});
const db = getFirestore(app);
async function run() {
  const c = await getDocs(collection(db, 'projects'));
  c.forEach(doc => {
      console.log('Project:', doc.id);
      console.dir(doc.data().reportingPeriods.periods, { depth: null });
  });
  console.log('done');
  process.exit(0);
}
run();
