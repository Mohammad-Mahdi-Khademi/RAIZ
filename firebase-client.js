import { firebaseConfig } from './firebase-config.js';

let connection;
const normalize = value => String(value || '').trim().replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
const studentEmail = value => `${normalize(value)}@students.raizlab.invalid`;
const pages = ['about', 'projects', 'apply', 'contact', 'publications'];
const fail = code => { throw new Error(code); };
function text(value, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid');
  return value.trim();
}
async function connect() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) fail('firebaseSetup');
  if (!connection) connection = (async () => {
    const [appSdk, authSdk, store] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')
    ]);
    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    const db = store.getFirestore(app);
    await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);
    await auth.authStateReady();
    return { appSdk, authSdk, store, app, auth, db };
  })().catch(error => { connection = undefined; throw error; });
  return connection;
}
async function profile(c) {
  if (!c.auth.currentUser) return null;
  const snapshot = await c.store.getDoc(c.store.doc(c.db, 'members', c.auth.currentUser.uid));
  if (!snapshot.exists() || snapshot.data().active !== true) return null;
  return { id: snapshot.id, ...snapshot.data() };
}
async function requireMember(c, admin = false) {
  const member = await profile(c);
  if (!member) fail('loginRequired');
  if (admin && member.role !== 'admin') fail('forbidden');
  return member;
}
async function request(path, data) {
  const c = await connect();
  const { store: s, authSdk: a, db, auth } = c;
  if (path === 'content') {
    const result = await s.getDocs(s.collection(db, 'content'));
    return result.docs.map(doc => ({ key: doc.id, ...doc.data() }));
  }
  if (path === 'session') {
    const member = await profile(c);
    return member ? { name: member.name, role: member.role } : null;
  }
  if (path === 'login') {
    const role = data.role === 'admin' ? 'admin' : 'student';
    const login = role === 'student' ? normalize(text(data.login)) : text(data.login).toLowerCase();
    const secret = role === 'student' ? normalize(text(data.secret)) : String(data.secret || '');
    if (role === 'student' && (!/^\d{5,20}$/.test(login) || !/^\d{10}$/.test(secret))) fail('credentials');
    await a.signInWithEmailAndPassword(auth, role === 'student' ? studentEmail(login) : login, secret);
    try {
      const member = await profile(c);
      if (!member || member.role !== role) fail('accountUnregistered');
      return { name: member.name, role: member.role };
    } catch (error) { await a.signOut(auth); throw error; }
  }
  if (path === 'logout') { await a.signOut(auth); return { ok: true }; }
  const member = await requireMember(c, path.startsWith('admin/'));
  if (path === 'equipment') {
    const result = await s.getDocs(s.collection(db, 'equipment'));
    return result.docs.map(doc => {
      const item = doc.data();
      return { id: doc.id, name: item.name, location: item.location, borrowed: item.holder !== null, mine: item.holder === member.id };
    }).sort((x, y) => x.name.localeCompare(y.name));
  }
  if (path === 'operation') {
    if (!['borrow', 'return'].includes(data.action) || !/^[a-zA-Z0-9_-]{1,100}$/.test(String(data.id))) fail('invalid');
    const equipment = s.doc(db, 'equipment', String(data.id));
    const log = s.doc(s.collection(db, 'equipmentLogs'));
    await s.runTransaction(db, async transaction => {
      const snapshot = await transaction.get(equipment);
      if (!snapshot.exists()) fail('notFound');
      const item = snapshot.data();
      if (data.action === 'borrow' ? item.holder !== null : item.holder !== member.id) fail('conflict');
      transaction.update(equipment, { holder: data.action === 'borrow' ? member.id : null, updatedAt: s.serverTimestamp(), lastOperation: log.id });
      transaction.set(log, { equipmentId: snapshot.id, equipment: item.name, userId: member.id, student: member.name, action: data.action, createdAt: s.serverTimestamp() });
    });
    return { ok: true };
  }
  if (path === 'admin/data') {
    const [users, logs] = await Promise.all([
      s.getDocs(s.collection(db, 'members')),
      s.getDocs(s.query(s.collection(db, 'equipmentLogs'), s.orderBy('createdAt', 'desc'), s.limit(200)))
    ]);
    return { users: users.docs.map(doc => ({ id: doc.id, ...doc.data() })), logs: logs.docs.map(doc => ({ ...doc.data(), created: doc.data().createdAt.toDate().toISOString() })) };
  }
  if (path === 'admin/users') {
    const role = data.role === 'admin' ? 'admin' : 'student';
    const login = role === 'student' ? normalize(text(data.login)) : text(data.login).toLowerCase();
    const secret = role === 'student' ? normalize(text(data.secret)) : String(data.secret || '');
    const name = text(data.name);
    if (role === 'student' && !/^\d{10}$/.test(secret)) fail('nationalFormat');
    if (role === 'student' && !/^\d{5,20}$/.test(login)) fail('invalid');
    if (role === 'admin' && (secret.length < 12 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login))) fail('passwordLength');
    const secondary = c.appSdk.initializeApp(firebaseConfig, 'registration-' + crypto.randomUUID());
    const registrationAuth = a.getAuth(secondary);
    let created;
    let saved = false;
    try {
      await a.setPersistence(registrationAuth, a.inMemoryPersistence);
      const credentials = await a.createUserWithEmailAndPassword(registrationAuth, role === 'student' ? studentEmail(login) : login, secret);
      created = credentials.user;
      await s.setDoc(s.doc(db, 'members', created.uid), { name, login, role, active: true });
      saved = true;
    } catch (error) {
      if (created && !saved) {
        try { await a.deleteUser(created); } catch { fail('registrationIncomplete'); }
      }
      throw error;
    } finally {
      await a.signOut(registrationAuth).catch(() => {});
      await c.appSdk.deleteApp(secondary).catch(() => {});
    }
    return { ok: true };
  }
  if (path === 'admin/equipment') {
    await s.addDoc(s.collection(db, 'equipment'), { name: text(data.name), location: text(data.location), holder: null, updatedAt: s.serverTimestamp(), lastOperation: null });
    return { ok: true };
  }
  if (path === 'admin/content') {
    if (!pages.includes(data.key)) fail('invalid');
    await s.setDoc(s.doc(db, 'content', data.key), { en: text(data.en, 12000), fa: text(data.fa, 12000) });
    return { ok: true };
  }
  fail('notFound');
}
export async function firebaseRequest(path, data) {
  try { return await request(path, data); }
  catch (error) {
    const codes = {
      'auth/invalid-credential': 'credentials', 'auth/wrong-password': 'credentials', 'auth/user-not-found': 'credentials',
      'auth/invalid-email': 'invalid', 'auth/user-disabled': 'accountUnregistered', 'auth/too-many-requests': 'rateLimit',
      'auth/email-already-in-use': 'duplicate', 'auth/weak-password': 'passwordPolicy', 'auth/password-does-not-meet-requirements': 'passwordPolicy',
      'auth/operation-not-allowed': 'authSetup', 'auth/invalid-api-key': 'firebaseSetup', 'auth/network-request-failed': 'network',
      'permission-denied': 'firebasePermission', 'unavailable': 'network', 'failed-precondition': 'firebaseSetup'
    };
    if (error.code) throw new Error(codes[error.code] || 'serverError');
    if (error instanceof TypeError) throw new Error('network');
    throw error;
  }
}
