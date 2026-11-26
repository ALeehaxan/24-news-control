const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { assertFails, assertSucceeds, initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, onSnapshot } = require('firebase/firestore');

test('Firestore restricts synced newsroom data to verified Google admins', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-24-news',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
  const google = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
  const reference = db => doc(db, 'newsrooms/main');
  const membership = (db, uid) => doc(db, 'admins', uid);
  const data = { stories: [], sources: [], version: 'test' };
  try {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(membership(context.firestore(), 'admin'), {});
    });
    const admin = env.authenticatedContext('admin', google).firestore();
    const secondDevice = env.authenticatedContext('admin', google).firestore();
    const guest = env.authenticatedContext('guest', google).firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const unverified = env.authenticatedContext('admin', { ...google, email_verified: false }).firestore();
    const wrongProvider = env.authenticatedContext('admin', { ...google, firebase: { sign_in_provider: 'password' } }).firestore();

    for (const blocked of [guest, anonymous, unverified, wrongProvider]) {
      await assertFails(getDoc(reference(blocked)));
      await assertFails(setDoc(reference(blocked), data));
    }
    await assertFails(setDoc(membership(guest, 'guest'), {}));
    await assertFails(getDoc(membership(guest, 'admin')));
    await assertFails(deleteDoc(membership(admin, 'admin')));
    await assertSucceeds(getDoc(membership(admin, 'admin')));
    await assertSucceeds(setDoc(reference(admin), data));
    await assertFails(setDoc(reference(admin), { ...data, extra: 'field' }));
    await assertFails(setDoc(doc(admin, 'newsrooms/unknown'), data));

    let stop;
    const synced = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Second device did not receive the update')), 5000);
      stop = onSnapshot(reference(secondDevice), snapshot => {
        if (snapshot.data()?.version === 'second-version') {
          clearTimeout(timeout);
          resolve(snapshot.data());
        }
      }, error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    try {
      const update = { ...data, version: 'second-version' };
      await assertSucceeds(setDoc(reference(admin), update));
      assert.deepEqual(await synced, update);
    } finally {
      stop();
    }
    await env.withSecurityRulesDisabled(async context => {
      await deleteDoc(membership(context.firestore(), 'admin'));
    });
    await assertFails(setDoc(reference(admin), data));
  } finally {
    await env.cleanup();
  }
});
