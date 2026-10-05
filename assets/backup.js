'use strict';
// JSZip builds the archive in memory. Limit both record count and accumulated
// source image bytes so large exports remain safe on mobile devices.
const MAX_EXPORT_BATCH=100;
const MAX_EXPORT_SOURCE_BYTES=120*1024*1024; // 120 MB before ZIP overhead
async function sha256Hex(blob){const b=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function priorBatchId(r){return r.last_export_batch_id||r.export_batch_id||null;}
function priorExportTime(r){return r.last_exported_at||r.exported_at||null;}
async function exportBackup({all=false,userId=null,mode='new'}={}){
  if(typeof JSZip==='undefined')throw new Error('Backup library is unavailable.');
  const session=currentSession();if(!session)throw new Error('Please login first.');
  if(all&&session.role!=='admin')throw new Error('Administrator required.');

  let candidates=(await dbGetAll('captures')).filter(r=>!r.pseudo_deleted);
  if(!all)candidates=candidates.filter(r=>r.user_id===(userId||session.user_id));
  if(mode==='new')candidates=candidates.filter(r=>!priorBatchId(r));
  if(!candidates.length)return{exported:0,remaining:0,batch_id:null,bytes:0};

  // New exports: chronological order. Re-exports: least recently exported first,
  // so repeated batches rotate through the complete archive instead of getting
  // stuck on the same first 100 records.
  candidates.sort((a,b)=>{
    if(mode==='all'){
      const at=priorExportTime(a)||'',bt=priorExportTime(b)||'';
      if(at!==bt)return at.localeCompare(bt);
    }
    return String(a.captured_at||'').localeCompare(String(b.captured_at||''));
  });

  const selected=[];let sourceBytes=0;
  for(const r of candidates){
    if(selected.length>=MAX_EXPORT_BATCH)break;
    const imageBlob=await getRecordImageBlob(r);
    if(!imageBlob)continue;
    if(selected.length && sourceBytes+imageBlob.size>MAX_EXPORT_SOURCE_BYTES)break;
    if(!selected.length && imageBlob.size>MAX_EXPORT_SOURCE_BYTES)throw new Error('The first record image is larger than the export safety limit. Reduce image size before exporting.');
    selected.push({record:r,imageBlob});sourceBytes+=imageBlob.size;
  }
  if(!selected.length)return{exported:0,remaining:candidates.length,batch_id:null,bytes:0};

  const batchId=String(Date.now());
  const exportedAt=appTimestamp();
  const zip=new JSZip(),meta=[];
  for(const {record:r,imageBlob} of selected){
    const imageName=`images/${r.display_record_id||'record'}_${r.record_id}.jpg`;
    zip.file(imageName,imageBlob);
    const m={...r,image_blob:undefined,image_file:imageName};
    delete m.image_blob;
    meta.push(m);
  }
  const remaining=Math.max(0,candidates.length-selected.length);
  const payload={
    export_version:3,application:'Offline QR Capture',app_version:APP_VERSION,
    db_schema_version:DB_SCHEMA_VERSION,qr_schema_version:QR_SCHEMA_VERSION,
    device_uuid:await getSetting('device_uuid',''),device_code:await getSetting('device_code',''),device_name:await getSetting('device_name',''),
    exported_at:exportedAt,export_batch_id:batchId,record_count:meta.length,
    records_remaining_after_this_batch:remaining,max_export_batch:MAX_EXPORT_BATCH,
    max_export_source_bytes:MAX_EXPORT_SOURCE_BYTES,source_image_bytes:sourceBytes,
    scope:all?'all_users':'current_user',mode,records:meta
  };
  zip.file('records.json',JSON.stringify(payload,null,2));
  zip.file('manifest.json',JSON.stringify({
    export_batch_id:batchId,created_at:exportedAt,record_count:meta.length,source_image_bytes:sourceBytes,
    records:meta.map(r=>({record_id:r.record_id,display_record_id:r.display_record_id,image_file:r.image_file,image_sha256:r.image_sha256}))
  },null,2));

  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  const dev=(await getSetting('device_code','DEVICE')).replace(/[^A-Za-z0-9_-]/g,'_');
  downloadBlob(blob,`Offline_QR_Export_${dev}_${batchId}_${appFilenameStamp()}.zip`);

  // Export is not treated as confirmed delivery. We only record the latest
  // generated batch ID/time. Every record remains eligible for re-export.
  for(const {record:r} of selected){
    r.last_export_batch_id=batchId;
    r.last_exported_at=exportedAt;
    delete r.export_status; delete r.exported_at; delete r.export_batch_id;
    await dbPut('captures',r);
  }
  await setSetting('last_backup_at',exportedAt);
  return{exported:selected.length,remaining,batch_id:batchId,bytes:sourceBytes};
}
function downloadBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1000);}
