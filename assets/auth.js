'use strict';
const AUTH={sessionKey:'offline_qr_session'};
function bytesToB64(bytes){let s='';bytes.forEach(b=>s+=String.fromCharCode(b));return btoa(s);}
function b64ToBytes(v){return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
async function deriveVerifier(password,saltB64){const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:b64ToBytes(saltB64),iterations:200000,hash:'SHA-256'},key,256);return bytesToB64(new Uint8Array(bits));}
async function makePasswordFields(password){const salt=crypto.getRandomValues(new Uint8Array(16));const password_salt=bytesToB64(salt);const password_verifier=await deriveVerifier(password,password_salt);return{password_salt,password_verifier};}
async function createLocalUser({user_code,full_name,username,password,role='user'}){user_code=user_code.trim();full_name=full_name.trim();username=username.trim().toLowerCase();if(!user_code||!full_name||!username)throw new Error('All user fields are required.');if(password.length<8)throw new Error('Password must be at least 8 characters.');if(await dbGetByIndex('users','username',username))throw new Error('Username already exists.');if(await dbGetByIndex('users','user_code',user_code))throw new Error('User ID already exists.');const pass=await makePasswordFields(password);const now=appTimestamp();const user={id:crypto.randomUUID(),user_code,full_name,username,role:role==='admin'?'admin':'user',active:true,...pass,created_at:now,updated_at:now};await dbAdd('users',user);return user;}
async function loginLocal(username,password){const user=await dbGetByIndex('users','username',username.trim().toLowerCase());if(!user||!user.active)throw new Error('Invalid username or password.');const v=await deriveVerifier(password,user.password_salt);if(v!==user.password_verifier)throw new Error('Invalid username or password.');const session={user_id:user.id,user_code:user.user_code,full_name:user.full_name,username:user.username,role:user.role,login_at:appTimestamp()};sessionStorage.setItem(AUTH.sessionKey,JSON.stringify(session));return session;}
function currentSession(){try{return JSON.parse(sessionStorage.getItem(AUTH.sessionKey)||'null');}catch{return null;}}
function logoutLocal(){sessionStorage.removeItem(AUTH.sessionKey);}
async function resetLocalPassword(userId,newPassword){if(newPassword.length<8)throw new Error('Password must be at least 8 characters.');const u=await dbGet('users',userId);if(!u)throw new Error('User not found.');Object.assign(u,await makePasswordFields(newPassword),{updated_at:appTimestamp()});await dbPut('users',u);}


function randomRecoveryCode(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes=crypto.getRandomValues(new Uint8Array(20));
  let raw='';
  for(let i=0;i<bytes.length;i++)raw+=alphabet[bytes[i]%alphabet.length];
  return raw.match(/.{1,5}/g).join('-');
}
async function configureAdminRecovery(adminUserId){
  const code=randomRecoveryCode();
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const saltB64=bytesToB64(salt);
  const verifier=await deriveVerifier(code,saltB64);
  await setSetting('recovery_admin_id',adminUserId);
  await setSetting('recovery_code_salt',saltB64);
  await setSetting('recovery_code_verifier',verifier);
  await setSetting('recovery_created_at',appTimestamp());
  return code;
}
async function verifyRecoveryCode(code){
  const salt=await getSetting('recovery_code_salt','');
  const expected=await getSetting('recovery_code_verifier','');
  if(!salt||!expected)return false;
  const actual=await deriveVerifier(String(code||'').trim().toUpperCase(),salt);
  return actual===expected;
}
async function recoverAdministrator(code,newPassword){
  if(newPassword.length<8)throw new Error('Password must be at least 8 characters.');
  if(!(await verifyRecoveryCode(code)))throw new Error('Invalid recovery code.');
  const id=await getSetting('recovery_admin_id','');
  let admin=id?await dbGet('users',id):null;
  if(!admin){const users=await dbGetAll('users');admin=users.find(u=>u.role==='admin');}
  if(!admin)throw new Error('No local administrator was found.');
  await resetLocalPassword(admin.id,newPassword);
  admin.active=true;admin.updated_at=appTimestamp();await dbPut('users',admin);
  return admin;
}
async function deriveProvisioningKey(passphrase,salt){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
// `format` distinguishes the two kinds of encrypted package this app
// produces: the existing multi-device "user provisioning" package, and the
// newer full "device snapshot" package (users + settings + recovery code)
// used to recover a device after a reinstall. Same AES-GCM/PBKDF2 envelope
// either way - only the tag differs, so old provisioning packages continue
// to decrypt exactly as before.
async function encryptProvisioningPayload(payload,passphrase,format='OfflineQRCaptureUserProvisioning'){
  if(String(passphrase||'').length<8)throw new Error('Package password must be at least 8 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveProvisioningKey(passphrase,salt);
  const plain=new TextEncoder().encode(JSON.stringify(payload));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
  return{format,format_version:1,encryption:'AES-GCM',kdf:'PBKDF2-SHA256-200000',salt:bytesToB64(salt),iv:bytesToB64(iv),ciphertext:bytesToB64(new Uint8Array(encrypted))};
}
async function decryptProvisioningPackage(pkg,passphrase,expectedFormats=['OfflineQRCaptureUserProvisioning']){
  if(!pkg||!expectedFormats.includes(pkg.format)||pkg.format_version!==1)throw new Error('Unsupported or unexpected package type.');
  const salt=b64ToBytes(pkg.salt),iv=b64ToBytes(pkg.iv),cipher=b64ToBytes(pkg.ciphertext),key=await deriveProvisioningKey(passphrase,salt);
  try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher);return JSON.parse(new TextDecoder().decode(plain));}
  catch{throw new Error('Could not decrypt package. Check the password and file integrity.');}
}
