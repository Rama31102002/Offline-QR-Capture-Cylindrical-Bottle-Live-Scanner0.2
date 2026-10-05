'use strict';
const APP_VERSION='0.2', DB_SCHEMA_VERSION=3, QR_SCHEMA_VERSION=1;
const APP_DB={name:'OfflineQRCaptureDB',version:DB_SCHEMA_VERSION,db:null};
function openDB(){if(APP_DB.db)return Promise.resolve(APP_DB.db);return new Promise((resolve,reject)=>{const req=indexedDB.open(APP_DB.name,APP_DB.version);req.onupgradeneeded=()=>{const db=req.result;let s;if(!db.objectStoreNames.contains('users')){s=db.createObjectStore('users',{keyPath:'id'});s.createIndex('username','username',{unique:true});s.createIndex('user_code','user_code',{unique:true});s.createIndex('role','role');s.createIndex('active','active');}if(!db.objectStoreNames.contains('captures')){s=db.createObjectStore('captures',{keyPath:'record_id'});}else{s=req.transaction.objectStore('captures');}for(const [n,k] of [['user_id','user_id'],['user_code','user_code'],['capture_date','capture_date'],['captured_at','captured_at'],['label_a_raw','label_a_raw'],['label_b_raw','label_b_raw'],['export_status','export_status'],['last_export_batch_id','last_export_batch_id'],['last_exported_at','last_exported_at'],['device_code','device_code'],['pseudo_deleted','pseudo_deleted']])if(!s.indexNames.contains(n))s.createIndex(n,k);if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'});};req.onsuccess=()=>{APP_DB.db=req.result;APP_DB.db.onversionchange=()=>APP_DB.db.close();resolve(APP_DB.db);};req.onerror=()=>reject(req.error);});}
async function txStore(name,mode='readonly'){const db=await openDB();return db.transaction(name,mode).objectStore(name);}async function dbGet(store,key){const s=await txStore(store);return new Promise((res,rej)=>{const r=s.get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}async function dbPut(store,value){const s=await txStore(store,'readwrite');return new Promise((res,rej)=>{const r=s.put(value);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}async function dbAdd(store,value){const s=await txStore(store,'readwrite');return new Promise((res,rej)=>{const r=s.add(value);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}async function dbGetAll(store){const s=await txStore(store);return new Promise((res,rej)=>{const r=s.getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}async function dbGetByIndex(store,index,key){const s=await txStore(store);return new Promise((res,rej)=>{const r=s.index(index).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}async function dbGetAllByIndex(store,index,key){const s=await txStore(store);return new Promise((res,rej)=>{const r=s.index(index).getAll(key);r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}async function getSetting(key,fallback=null){const r=await dbGet('settings',key);return r?r.value:fallback;}async function setSetting(key,value){return dbPut('settings',{key,value,updated_at:appTimestamp()});}
async function ensureDefaultSettings(){const defaults={app_name:'Offline QR Capture',gps_required:true,image_max_width:1600,jpeg_quality:0.8,allow_user_delete:false,last_backup_at:null,device_uuid:crypto.randomUUID(),device_code:'',device_name:'',device_location:'',oil_spec:'Turbonic210A',app_version:APP_VERSION,db_schema_version:DB_SCHEMA_VERSION,qr_schema_version:QR_SCHEMA_VERSION,storage_warning_ratio:0.70,record_seq_counter:0,snapshot_dirty:true,last_snapshot_at:null};for(const [k,v] of Object.entries(defaults)){if(await getSetting(k,undefined)===undefined)await setSetting(k,v);}try{await navigator.storage?.persist?.();}catch{}}

// Persisted, monotonically-increasing counter for display_record_id sequence
// numbers. Previously this was derived as `captures.length + 1`, which
// resets to 1 whenever local storage is wiped (e.g. an app reinstall) -
// letting a brand-new record collide with the display ID of an
// already-exported one from before the reinstall. Persisting it as its own
// setting means it can be carried forward by a Device Snapshot restore
// (see auth.js / exportDeviceSnapshot) so numbering never restarts.
async function nextRecordSeq(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('settings','readwrite');
    const store=tx.objectStore('settings');
    const req=store.get('record_seq_counter');
    let next=1;
    req.onsuccess=()=>{
      next=Number(req.result?.value||0)+1;
      store.put({key:'record_seq_counter',value:next,updated_at:appTimestamp()});
      store.put({key:'snapshot_dirty',value:true,updated_at:appTimestamp()});
    };
    req.onerror=()=>reject(req.error);
    tx.oncomplete=()=>resolve(next);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Could not reserve record sequence.'));
  });
}

// Marks that local users/settings have changed since the last Device
// Snapshot export, so the admin can be reminded to take a fresh one.
async function markSnapshotDirty(){await setSetting('snapshot_dirty',true);}

async function saveImageToLocalStorage(recordId,blob){
  if(navigator.storage?.getDirectory){
    try{const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('capture-images',{create:true});const h=await dir.getFileHandle(`${recordId}.jpg`,{create:true});const w=await h.createWritable();await w.write(blob);await w.close();return{image_storage:'opfs',image_file:`capture-images/${recordId}.jpg`,image_blob:null};}catch(e){console.warn('OPFS unavailable, using IndexedDB Blob fallback.',e);}
  }
  return{image_storage:'indexeddb',image_file:null,image_blob:blob};
}
async function getRecordImageBlob(r){
  if(r.image_blob instanceof Blob)return r.image_blob;
  if(r.image_storage==='opfs'&&r.image_file&&navigator.storage?.getDirectory){const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('capture-images');const h=await dir.getFileHandle(r.image_file.split('/').pop());return await h.getFile();}
  throw new Error('Stored image is unavailable.');
}

async function deleteRecordImage(r){
  if(!r)return;
  if(r.image_storage==='opfs'&&r.image_file&&navigator.storage?.getDirectory){
    try{const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('capture-images');await dir.removeEntry(r.image_file.split('/').pop());}catch{}
  }
}
