'use strict';
const UI={views:{},session:null,capturedBlob:null,capturedUrl:null,decodedQR:null,lastSavedId:null,currentDetail:null,recordsMode:'list',recordsAdminMode:false,recordsPageSize:25,recordsShown:25,deferredInstall:null,recoveryCode:null,recordThumbUrls:[]};
const $=id=>document.getElementById(id);
const fmtDateTime=iso=>{try{return new Date(iso).toLocaleString();}catch{return iso||'—';}};
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function setMsg(el,msg,type=''){el.textContent=msg||'';el.className='message'+(type?' '+type:'');}
function showView(name){Object.values(UI.views).forEach(v=>v.classList.add('hidden'));UI.views[name].classList.remove('hidden');window.scrollTo({top:0,behavior:'instant'});}
function sessionUserText(){return UI.session?`${UI.session.user_code} · ${UI.session.full_name}`:'';}
function updateHeader(){UI.session=currentSession();$('userBadge').textContent=UI.session?sessionUserText():'';}
async function init(){UI.views={setup:$('setupView'),login:$('loginView'),dashboard:$('dashboardView'),scan:$('scanView'),success:$('successView'),records:$('recordsView'),detail:$('detailView'),admin:$('adminView')};await openDB();await ensureDefaultSettings();$('appTitle').textContent=await getSetting('app_name','Offline QR Capture');updateHeader();bindEvents();registerPWA();const users=await dbGetAll('users');if(!users.length){showView('setup');return;}if(UI.session){await openDashboard();}else showView('login');}
function bindEvents(){
 $('setupForm').addEventListener('submit',async e=>{e.preventDefault();setMsg($('setupMsg'),'Creating administrator...');try{if($('setupPassword').value!==$('setupPassword2').value)throw new Error('Passwords do not match.');await setSetting('device_code',$('setupDeviceCode').value.trim());await setSetting('device_name',$('setupDeviceName').value.trim());await setSetting('device_location',$('setupDeviceLocation').value.trim());const admin=await createLocalUser({user_code:$('setupCode').value,full_name:$('setupName').value,username:$('setupUsername').value,password:$('setupPassword').value,role:'admin'});UI.recoveryCode=await configureAdminRecovery(admin.id);await markSnapshotDirty();$('recoveryCodeText').textContent=UI.recoveryCode;$('recoveryKit').classList.remove('hidden');$('setupForm').classList.add('hidden');$('restoreDeviceBlock')?.classList.add('hidden');$('loginUsername').value=$('setupUsername').value.trim().toLowerCase();setMsg($('setupMsg'),'Administrator created. Save the recovery code before continuing, then take a Device Snapshot from the Admin page as soon as you sign in.','success');}catch(err){setMsg($('setupMsg'),err.message,'error');}});
 $('restoreSnapshotBtn')?.addEventListener('click',async()=>{
   const file=$('restoreSnapshotFile').files?.[0];const pass=$('restoreSnapshotPassword').value;
   if(!file){setMsg($('restoreMsg'),'Choose a device snapshot file first.','error');return;}
   if(!pass){setMsg($('restoreMsg'),'Enter the snapshot password.','error');return;}
   setMsg($('restoreMsg'),'Restoring device...');
   try{
     const existingUsers=await dbGetAll('users');
     if(existingUsers.length)throw new Error('This device already has local users. Restore is only available on a brand-new install.');
     const raw=JSON.parse(await file.text());
     const payload=await decryptProvisioningPackage(raw,pass,['OfflineQRCaptureDeviceSnapshot']);
     if(!Array.isArray(payload.users)||!payload.users.length)throw new Error('Snapshot does not contain any users.');
     for(const u of payload.users)await dbAdd('users',u);
     for(const [k,v] of Object.entries(payload.settings||{}))await setSetting(k,v);
     await setSetting('snapshot_dirty',false);
     await setSetting('last_snapshot_at',payload.created_at||appTimestamp());
     setMsg($('restoreMsg'),`Device restored: ${payload.users.length} user(s) and settings recovered. You can sign in now.`,'success');
     $('restoreSnapshotFile').value='';$('restoreSnapshotPassword').value='';
     setTimeout(()=>showView('login'),1000);
   }catch(err){setMsg($('restoreMsg'),err.message,'error');}
 });
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();setMsg($('loginMsg'),'Checking local credentials...');try{UI.session=await loginLocal($('loginUsername').value,$('loginPassword').value);$('loginPassword').value='';updateHeader();await openDashboard();}catch(err){setMsg($('loginMsg'),err.message,'error');}});
 $('recoverAdminBtn').onclick=async()=>{const code=prompt('Enter the administrator recovery code saved during initial setup:');if(code===null)return;const p=prompt('Enter a NEW administrator password (minimum 8 characters):');if(p===null)return;const p2=prompt('Enter the same new password again:');if(p!==p2){setMsg($('loginMsg'),'Passwords do not match.','error');return;}try{const admin=await recoverAdministrator(code,p);$('loginUsername').value=admin.username;setMsg($('loginMsg'),'Administrator password reset successfully. You can sign in now.','success');}catch(e){setMsg($('loginMsg'),e.message,'error');}};
 $('downloadRecoveryBtn').onclick=async()=>{if(!UI.recoveryCode)return;const text=[`Offline QR Capture Administrator Recovery`,`App Version: ${APP_VERSION}`,`Device Code: ${await getSetting('device_code','')}`,`Device Name: ${await getSetting('device_name','')}`,`Administrator Username: ${$('setupUsername').value.trim().toLowerCase()}`,`Recovery Code: ${UI.recoveryCode}`,`Created: ${appTimestamp()}`].join('\n');downloadBlob(new Blob([text],{type:'text/plain'}),`Offline_QR_Recovery_${(await getSetting('device_code','DEVICE')).replace(/[^A-Za-z0-9_-]/g,'_')}.txt`);};
 $('continueToLoginBtn').onclick=()=>{UI.recoveryCode=null;showView('login');};
 $('togglePassword').onclick=()=>{const p=$('loginPassword');p.type=p.type==='password'?'text':'password';$('togglePassword').textContent=p.type==='password'?'Show':'Hide';};
 $('logoutBtn').onclick=()=>{stopCamera();logoutLocal();UI.session=null;updateHeader();showView('login');};
 $('newScanBtn').onclick=startScanFlow;$('torchBtn').onclick=async()=>{try{const on=await setTorch(!CAMERA.torch);$('torchBtn').textContent=on?'Torch On':'Torch Off';}catch(e){alert(e.message);}};$('scanBackBtn').onclick=()=>{resetScan();openDashboard();};$('cancelScanBtn').onclick=()=>{resetScan();openDashboard();};$('switchCameraBtn').onclick=switchScanCamera;
 $('viewRecordsBtn').onclick=()=>openRecords(false);$('recordsBackBtn').onclick=()=>{revokeRecordThumbs();UI.recordsAdminMode?openAdmin():openDashboard();};$('listModeBtn').onclick=()=>{UI.recordsMode='list';renderRecords();};$('galleryModeBtn').onclick=()=>{UI.recordsMode='gallery';renderRecords();};['recordSearch','recordFrom','recordTo','recordSort','adminUserFilter'].forEach(id=>$(id)?.addEventListener('input',()=>{UI.recordsShown=25;renderRecords();}));$('loadMoreBtn').onclick=()=>{UI.recordsShown+=UI.recordsPageSize;renderRecords();};
 $('detailBackBtn').onclick=()=>openRecords(UI.recordsAdminMode);$('engineHoursBtn').onclick=updateEngineHours;$('successNewBtn').onclick=startScanFlow;$('successViewBtn').onclick=()=>openDetail(UI.lastSavedId);$('successDashBtn').onclick=openDashboard;
 $('exportMineBtn').onclick=async()=>{try{const res=await exportBackup({all:false,userId:UI.session.user_id,mode:'new'});if(!res.exported){alert('No never-exported records are waiting. Use Re-export My Records if you need another copy.');return;}alert(`Export batch ${res.batch_id} created with ${res.exported} new record(s). Records remain re-exportable.`+(res.remaining?` ${res.remaining} never-exported record(s) remain — run Export New Records again.`:''));await refreshBackupReminder();}catch(e){alert(e.message);}};
 $('reexportMineBtn').onclick=async()=>{try{const res=await exportBackup({all:false,userId:UI.session.user_id,mode:'all'});if(!res.exported){alert('No records available to re-export.');return;}alert(`Re-export batch ${res.batch_id} created with ${res.exported} record(s).`+(res.remaining?` ${res.remaining} record(s) are outside this batch; run Re-export again to rotate through them.`:''));await refreshBackupReminder();}catch(e){alert(e.message);}};
 $('adminBtn').onclick=openAdmin;$('adminBackBtn').onclick=openDashboard;$('exportUsersBtn').onclick=exportUsersPackage;$('importUsersBtn').onclick=()=>$('importUsersFile').click();$('importUsersFile').onchange=importUsersPackage;$('createUserForm').addEventListener('submit',createUserFromAdmin);$('saveSettingsBtn').onclick=saveAdminSettings;$('viewAllRecordsBtn').onclick=()=>openRecords(true);$('exportSnapshotBtn')?.addEventListener('click',exportDeviceSnapshot);$('exportAllPendingBtn').onclick=async()=>{try{const res=await exportBackup({all:true,mode:'new'});alert(res.exported?`Export batch ${res.batch_id} created with ${res.exported} never-exported record(s) from all users.`+(res.remaining?` ${res.remaining} never-exported record(s) remain.`:''):'No never-exported records remain.');}catch(e){alert(e.message);}};$('reexportAllBtn').onclick=async()=>{try{const res=await exportBackup({all:true,mode:'all'});alert(res.exported?`Re-export batch ${res.batch_id} created with ${res.exported} record(s).`+(res.remaining?` ${res.remaining} record(s) are outside this batch; run again to rotate through them.`:''):'No records available to re-export.');}catch(e){alert(e.message);}};$('deleteRecordBtn').onclick=deleteCurrentRecord;
 window.addEventListener('pagehide',stopCamera);window.addEventListener('beforeunload',stopCamera);
}
async function openDashboard(){UI.session=currentSession();if(!UI.session){showView('login');return;}updateHeader();$('dashUserCode').textContent=UI.session.user_code;$('dashName').textContent=UI.session.full_name;$('dashRole').textContent=UI.session.role;$('dashDevice').textContent=`${await getSetting('device_code','')} · ${await getSetting('device_name','')}`;$('versionText').textContent=`App ${APP_VERSION} · DB ${DB_SCHEMA_VERSION} · QR ${QR_SCHEMA_VERSION}`;$('scanUserCode').textContent=UI.session.user_code;$('adminBtn').classList.toggle('hidden',UI.session.role!=='admin');const mine=await dbGetAllByIndex('captures','user_id',UI.session.user_id);const today=appDate();$('todayCount').textContent=mine.filter(r=>r.capture_date===today).length;$('userCount').textContent=mine.length;await refreshStorage();await refreshBackupReminder();showView('dashboard');}
async function refreshStorage(){try{const est=await navigator.storage?.estimate?.();if(est&&est.usage!=null){const ratio=est.quota?est.usage/est.quota:0;$('storageText').textContent=formatBytes(est.usage)+(est.quota?` / ${formatBytes(est.quota)}`:'');if(ratio>=Number(await getSetting('storage_warning_ratio',.70)))$('storageText').textContent+=' ⚠';}else $('storageText').textContent='Local';}catch{$('storageText').textContent='Local';}}
function formatBytes(n){if(n<1024)return`${n} B`;if(n<1024**2)return`${(n/1024).toFixed(1)} KB`;if(n<1024**3)return`${(n/1024**2).toFixed(1)} MB`;return`${(n/1024**3).toFixed(2)} GB`;}
async function refreshBackupReminder(){const last=await getSetting('last_backup_at',null);const el=$('backupReminder');if(!last){el.classList.remove('hidden');el.innerHTML='<strong>Backup Recommended</strong><p>No backup has been recorded on this device yet.</p>';return;}const days=(Date.now()-new Date(last).getTime())/86400000;if(days>=7){el.classList.remove('hidden');el.innerHTML=`<strong>Backup Recommended</strong><p>Last backup was about ${Math.floor(days)} day(s) ago.</p>`;}else el.classList.add('hidden');}
async function startScanFlow(){
 if(!UI.session)return;
 resetScan(false);
 showView('scan');
 setMsg($('scanMsg'),'Opening camera...');
 try{
   const info=await startCamera($('cameraVideo'),'environment');
   updateCameraButtons(info);
   beginAutomaticScan();
 }catch(e){setMsg($('scanMsg'),e.message,'error');}
}

function updateCameraButtons(info={}){
 $('torchBtn').classList.toggle('hidden',!info.torch);
 $('torchBtn').textContent='Torch Off';
 $('switchCameraBtn').textContent=CAMERA.facingMode==='environment'?'Use Front Camera':'Use Rear Camera';
}

function setLabelStatus(id,found){
 const el=$(id);el.classList.toggle('found',Boolean(found));
 el.querySelector('strong').textContent=found?'Detected ✓':'Searching...';
}

function beginAutomaticScan(){
 setLabelStatus('labelAStatus',false);setLabelStatus('labelBStatus',false);
 setMsg($('scanMsg'),'Scanning automatically. Keep both QR labels visible in the same frame.');
 startLiveQRScanner($('cameraVideo'),{
   onStatus:s=>{
     setLabelStatus('labelAStatus',s.labelA);setLabelStatus('labelBStatus',s.labelB);
     setMsg($('scanMsg'),s.message,s.labelA||s.labelB?'success':'');
   },
   onSuccess:async result=>{
     UI.capturedBlob=result.capturedBlob;
     UI.decodedQR={labelA:result.labelA,labelB:result.labelB,
       scan_duration_ms:result.scan_duration_ms,
       candidates_checked:result.candidates_checked,
       worker_elapsed_ms:result.worker_elapsed_ms};
     setLabelStatus('labelAStatus',true);setLabelStatus('labelBStatus',true);
     stopCamera();
     $('processPanel').classList.remove('hidden');$('processText').textContent='Both labels detected. Capturing GPS and saving...';
     setMsg($('scanMsg'),'Both valid labels were decoded from the same original camera frame.','success');
     await completeCapture();
   },
   onError:e=>setMsg($('scanMsg'),e.message||String(e),'error')
 });
}

async function switchScanCamera(){
 try{
   stopLiveQRScanner();
   setMsg($('scanMsg'),'Switching camera...');
   const info=await switchCamera($('cameraVideo'));
   updateCameraButtons(info);
   beginAutomaticScan();
 }catch(e){setMsg($('scanMsg'),e.message,'error');}
}

function resetScan(navigate=false){
 stopLiveQRScanner();stopCamera();UI.capturedBlob=null;UI.decodedQR=null;
 setLabelStatus('labelAStatus',false);setLabelStatus('labelBStatus',false);
 $('torchBtn').classList.add('hidden');$('processPanel').classList.add('hidden');setMsg($('scanMsg'),'');
 if(navigate)openDashboard();
}

async function completeCapture(){
 if(!UI.capturedBlob||!UI.decodedQR)return;
 $('processPanel').classList.remove('hidden');$('processText').textContent='Getting GPS location...';
 try{
   let gps={latitude:null,longitude:null,accuracy:null,gps_status:'failed'};
   const required=Boolean(await getSetting('gps_required',true));
   try{gps=await getGPS();}catch(e){if(required)throw new Error(`${e.message} GPS is required, so the record was not saved.`);gps.gps_error=e.message;}
   $('processText').textContent='Saving locally...';
   const now=new Date(),recordId=crypto.randomUUID(),deviceCode=await getSetting('device_code','DEVICE'),seq=String(await nextRecordSeq()).padStart(6,'0');
   const storageMax=Number(await getSetting('image_max_width',1600));const storageQ=Number(await getSetting('jpeg_quality',.8));
   const storageBlob=await recompressImageBlob(UI.capturedBlob,storageMax,storageQ);const imageHash=await sha256Hex(storageBlob);const A=UI.decodedQR.labelA,B=UI.decodedQR.labelB;
   const record={record_id:recordId,display_record_id:`${deviceCode}-${appDate(now).replaceAll('-','')}-${seq}`,device_uuid:await getSetting('device_uuid',''),device_code:deviceCode,device_name:await getSetting('device_name',''),device_location:await getSetting('device_location',''),user_id:UI.session.user_id,user_code:UI.session.user_code,username:UI.session.username,full_name:UI.session.full_name,label_a_raw:A.raw,label_a_normalized:A.normalized,bottle_uuid:A.bottle_uuid,rack:A.rack,shelf:A.shelf,crate:A.crate,x:A.x,y:A.y,future:A.future,label_a_scan_preset:A.scan_preset||null,label_b_raw:B.raw,label_b_normalized:B.normalized,label_warnings:[...(A.warnings||[]),...(B.warnings||[])],sticker_uuid:B.sticker_uuid,aircraft_tail_no:B.aircraft_tail_no,engine_no:B.engine_no,engine_side:B.engine_side,engine_side_raw:B.engine_side_raw||B.engine_side,label_b_scan_preset:B.scan_preset||null,qr_scan_duration_ms:UI.decodedQR.scan_duration_ms||null,qr_candidates_checked:UI.decodedQR.candidates_checked||null,qr_worker_elapsed_ms:UI.decodedQR.worker_elapsed_ms||null,camera_facing_mode:CAMERA.facingMode,oil_spec:await getSetting('oil_spec','Turbonic210A'),engine_hours:null,engine_hours_entered_at:null,engine_hours_entered_by:null,capture_date:appDate(now),capture_time:appTime(now),captured_at:appTimestamp(now),timezone:APP_TIME_ZONE,latitude:gps.latitude,longitude:gps.longitude,accuracy:gps.accuracy,gps_status:gps.gps_status,gps_error:gps.gps_error||null,image_type:storageBlob.type||'image/jpeg',image_sha256:imageHash,last_export_batch_id:null,last_exported_at:null,pseudo_deleted:false,deleted_at:null,deleted_by:null,app_version:APP_VERSION,db_schema_version:DB_SCHEMA_VERSION,qr_schema_version:QR_SCHEMA_VERSION,created_at:appTimestamp()};
   const dupe=await recentDuplicate(record);if(dupe&&!confirm('This same QR combination was captured recently. Save anyway?'))throw new Error('Save cancelled.');
   const imageRef=await saveImageToLocalStorage(recordId,storageBlob);Object.assign(record,imageRef);
   try{await dbAdd('captures',record);}catch(err){await deleteRecordImage(record);throw err;}
   UI.lastSavedId=record.record_id;UI.currentDetail=record;$('processPanel').classList.add('hidden');renderSuccess(record);showView('success');UI.capturedBlob=null;UI.decodedQR=null;
 }catch(e){
   $('processPanel').classList.add('hidden');setMsg($('scanMsg'),e.message,'error');
   // If save/GPS failed, reopen camera and resume automatic scanning only after user returns to New Scan.
 }
}

async function getGPS(){if(!navigator.geolocation)throw new Error('Location is not supported on this device.');return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,gps_status:'success'}),e=>reject(new Error(e.code===1?'Location permission was denied.':e.code===2?'Location is currently unavailable.':'Location request timed out.')),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));}
async function recentDuplicate(r){const mine=await dbGetAllByIndex('captures','user_id',r.user_id);const cutoff=Date.now()-5*60000;return mine.find(x=>!x.pseudo_deleted&&(x.label_a_normalized||x.label_a_raw)===(r.label_a_normalized||r.label_a_raw)&&(x.label_b_normalized||x.label_b_raw)===(r.label_b_normalized||r.label_b_raw)&&new Date(x.captured_at).getTime()>=cutoff);}
function renderSuccess(r){$('successDetails').innerHTML=detailHtml(r,false);}
async function openRecords(adminMode=false){UI.recordsAdminMode=adminMode&&UI.session?.role==='admin';UI.recordsShown=25;$('recordsHeading').textContent=UI.recordsAdminMode?'All Local Records':'My Records';$('recordsSub').textContent=UI.recordsAdminMode?'Administrator view across all local users.':`User ID: ${UI.session.user_code}`;$('adminUserFilterWrap').classList.toggle('hidden',!UI.recordsAdminMode);if(UI.recordsAdminMode){const users=await dbGetAll('users');$('adminUserFilter').innerHTML='<option value="">All users</option>'+users.map(u=>`<option value="${esc(u.id)}">${esc(u.user_code)} - ${esc(u.full_name)}</option>`).join('');}showView('records');await renderRecords();}
async function filteredRecords(){let rows=(await dbGetAll('captures')).filter(r=>!r.pseudo_deleted);if(!UI.recordsAdminMode)rows=rows.filter(r=>r.user_id===UI.session.user_id);else if($('adminUserFilter').value)rows=rows.filter(r=>r.user_id===$('adminUserFilter').value);const q=$('recordSearch').value.trim().toLowerCase(),from=$('recordFrom').value,to=$('recordTo').value;if(q)rows=rows.filter(r=>String(r.label_a_raw).toLowerCase().includes(q)||String(r.label_b_raw).toLowerCase().includes(q)||String(r.bottle_uuid).toLowerCase().includes(q)||String(r.sticker_uuid).toLowerCase().includes(q)||String(r.user_code).toLowerCase().includes(q));if(from)rows=rows.filter(r=>r.capture_date>=from);if(to)rows=rows.filter(r=>r.capture_date<=to);rows.sort((a,b)=>$('recordSort').value==='asc'?String(a.captured_at).localeCompare(String(b.captured_at)):String(b.captured_at).localeCompare(String(a.captured_at)));return rows;}
function revokeRecordThumbs(){UI.recordThumbUrls.forEach(u=>URL.revokeObjectURL(u));UI.recordThumbUrls=[];}
function engineSideDisplay(value){
 const side=String(value||'').trim().toUpperCase();
 if(['LH','L','LEFT'].includes(side))return{className:'engine-left',badge:'LH',label:'Left engine'};
 if(['RH','R','RIGHT'].includes(side))return{className:'engine-right',badge:'RH',label:'Right engine'};
 return{className:'engine-unknown',badge:'?',label:'Engine side unknown'};
}
function captureDateHeading(dateValue){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue||''));
 if(!m)return String(dateValue||'Unknown date');
 const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
 return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(d);
}
async function renderRecords(){
 const all=await filteredRecords(),list=$('recordsList');
 // Keep a date group intact at a page boundary. If the 25th item belongs to
 // a date that has more records, include the rest of that date instead of
 // splitting one day's records across two Load More operations.
 let end=Math.min(UI.recordsShown,all.length);
 if(end>0&&end<all.length){const boundaryDate=all[end-1].capture_date;while(end<all.length&&all[end].capture_date===boundaryDate)end++;}
 const rows=all.slice(0,end);
 const dateCounts=new Map();for(const r of all)dateCounts.set(r.capture_date,(dateCounts.get(r.capture_date)||0)+1);
 // Every re-render (filter change, load-more, list/gallery toggle) used to
 // create a fresh object URL per visible thumbnail and only ever revoke the
 // one the user actually clicked into - the rest leaked for the life of the
 // page. Revoking the previous batch up front keeps memory bounded.
 revokeRecordThumbs();
 list.className='records-list'+(UI.recordsMode==='gallery'?' gallery':'');list.innerHTML='';
 let currentDate=null;
 for(const r of rows){
  if(r.capture_date!==currentDate){
   currentDate=r.capture_date;
   const heading=document.createElement('div');heading.className='record-date-heading';
   const count=dateCounts.get(currentDate)||0;
   heading.innerHTML=`<strong>${esc(captureDateHeading(currentDate))}</strong><span>${count} record${count===1?'':'s'}</span>`;
   list.appendChild(heading);
  }
  const side=engineSideDisplay(r.engine_side);
  const card=document.createElement('article');card.className=`record ${side.className}`;card.dataset.id=r.record_id;
  const url=URL.createObjectURL(await getRecordImageBlob(r));UI.recordThumbUrls.push(url);
  card.innerHTML=`<div class="record-row"><img src="${url}" alt="Capture thumbnail"><div class="record-meta"><div class="record-title-line"><strong>${esc(r.capture_time||'—')}</strong><span class="engine-side-badge" title="${esc(side.label)}">${esc(side.badge)}</span></div><p><b>Tail:</b> ${esc(r.aircraft_tail_no||'—')} · <b>Engine:</b> ${esc(r.engine_no||'—')} · <b>Bottle:</b> ${esc(r.bottle_uuid||'—')}</p><p>${esc(r.user_code)} · ${esc(r.full_name)}</p><p><b>Label A:</b> ${esc(r.label_a_raw)}</p><p><b>Label B:</b> ${esc(r.label_b_raw)}</p><p><b>Device:</b> ${esc(r.device_code)}</p><p><b>Last Export Batch:</b> ${esc(r.last_export_batch_id||r.export_batch_id||'Never')}</p><p><b>GPS:</b> ${r.gps_status==='success'?'Captured':'Unavailable'}</p></div></div>`;
  card.onclick=()=>openDetail(r.record_id);list.appendChild(card);
 }
 if(!rows.length)list.innerHTML='<p class="muted">No matching records.</p>';
 $('loadMoreBtn').classList.toggle('hidden',rows.length>=all.length);$('recordsMsg').textContent=`Showing ${rows.length} of ${all.length} record(s), grouped by capture date.`;
}
async function openDetail(id){const r=await dbGet('captures',id);if(!r){alert('Record not found.');return;}UI.currentDetail=r;showView('detail');if($('detailImage').dataset.url)URL.revokeObjectURL($('detailImage').dataset.url);const url=URL.createObjectURL(await getRecordImageBlob(r));$('detailImage').src=url;$('detailImage').dataset.url=url;$('detailMeta').innerHTML=detailHtml(r,true);const canDelete=UI.session.role==='admin'||Boolean(await getSetting('allow_user_delete',false));$('deleteRecordBtn').classList.toggle('hidden',!canDelete);}
function detailHtml(r,full=true){const rows=[['Reference',r.display_record_id],['Collector User ID',r.user_code],['Collector Name',r.full_name],['Device',`${r.device_code||''} · ${r.device_name||''}`],['Label A',r.label_a_raw],['Bottle UUID',r.bottle_uuid],['Rack',r.rack],['Shelf',r.shelf],['Crate',r.crate],['X',r.x],['Y',r.y],['Future',r.future],['Label B',r.label_b_raw],['Label Warnings',(r.label_warnings&&r.label_warnings.length)?r.label_warnings.join('; '):'None'],['Sticker UUID',r.sticker_uuid],['Aircraft Tail No',r.aircraft_tail_no],['Engine No',r.engine_no],['Engine Side',r.engine_side],['Oil Spec',r.oil_spec],['Engine Hours',r.engine_hours??'Not entered'],['Date',r.capture_date],['Time',r.capture_time],['Timestamp',r.captured_at],['Timezone',r.timezone],['GPS Status',r.gps_status],['Latitude',r.latitude??'—'],['Longitude',r.longitude??'—'],['GPS Accuracy',r.accuracy!=null?`${Math.round(r.accuracy)} m`:'—'],['QR Scan Presets',`A: ${r.label_a_scan_preset||'—'} · B: ${r.label_b_scan_preset||'—'}`],['QR Scan Time',r.qr_scan_duration_ms!=null?`${r.qr_scan_duration_ms} ms`:'—'],['Camera',r.camera_facing_mode||'—'],['Image SHA-256',r.image_sha256],['Last Export Batch',r.last_export_batch_id||r.export_batch_id||'Never'],['Last Exported At',r.last_exported_at||r.exported_at||'—'],['Record ID',r.record_id],['Versions',`App ${r.app_version||APP_VERSION} · DB ${r.db_schema_version||DB_SCHEMA_VERSION} · QR ${r.qr_schema_version||QR_SCHEMA_VERSION}`]];return rows.map(([k,v])=>`<div class="detail-row"><strong>${esc(k)}</strong><span>${esc(v)}</span></div>`).join('');}
async function updateEngineHours(){if(!UI.currentDetail)return;const v=prompt('Enter Engine Hours (this may be added later at the storage lab):',UI.currentDetail.engine_hours||'');if(v===null)return;const val=v.trim();if(!val){alert('Engine Hours cannot be blank.');return;}UI.currentDetail.engine_hours=val;UI.currentDetail.engine_hours_entered_at=appTimestamp();UI.currentDetail.engine_hours_entered_by=UI.session.user_id;await dbPut('captures',UI.currentDetail);alert('Engine Hours saved.');await openDetail(UI.currentDetail.record_id);}
async function deleteCurrentRecord(){if(!UI.currentDetail)return;if(!confirm('Mark this record as deleted? The data will be retained locally for audit.'))return;UI.currentDetail.pseudo_deleted=true;UI.currentDetail.deleted_at=appTimestamp();UI.currentDetail.deleted_by=UI.session.user_id;await dbPut('captures',UI.currentDetail);UI.currentDetail=null;alert('Record pseudo-deleted and retained for audit.');openRecords(UI.recordsAdminMode);}
async function openAdmin(){if(UI.session?.role!=='admin'){alert('Administrator required.');return;}showView('admin');$('gpsRequired').value=(await getSetting('gps_required',true))?'1':'0';$('imageMaxWidth').value=await getSetting('image_max_width',1600);$('jpegQuality').value=await getSetting('jpeg_quality',.8);$('allowUserDelete').value=(await getSetting('allow_user_delete',false))?'1':'0';$('deviceCode').value=await getSetting('device_code','');$('deviceName').value=await getSetting('device_name','');$('deviceLocation').value=await getSetting('device_location','');$('oilSpec').value=await getSetting('oil_spec','Turbonic210A');await renderUsers();await refreshSnapshotReminder();}
async function refreshSnapshotReminder(){const el=$('snapshotReminderMsg');if(!el)return;const dirty=await getSetting('snapshot_dirty',true);const last=await getSetting('last_snapshot_at',null);if(dirty||!last){el.textContent=last?`⚠ Users or settings changed since the last Device Snapshot (${fmtDateTime(last)}). Export a fresh one.`:'⚠ No Device Snapshot has been taken on this device yet. If this device is ever reinstalled or reset, anything not in a snapshot is lost.';el.classList.add('warning');}else{el.textContent=`Last Device Snapshot: ${fmtDateTime(last)}.`;el.classList.remove('warning');}}
async function createUserFromAdmin(e){e.preventDefault();setMsg($('adminMsg'),'Creating user...');try{await createLocalUser({user_code:$('newUserCode').value,full_name:$('newUserName').value,username:$('newUsername').value,password:$('newUserPassword').value,role:$('newUserRole').value});await markSnapshotDirty();e.target.reset();setMsg($('adminMsg'),'User created successfully.','success');await renderUsers();await refreshSnapshotReminder();}catch(err){setMsg($('adminMsg'),err.message,'error');}}
async function renderUsers(){const users=await dbGetAll('users');users.sort((a,b)=>a.full_name.localeCompare(b.full_name));$('usersTable').innerHTML=users.map(u=>`<tr><td>${esc(u.user_code)}</td><td>${esc(u.full_name)}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.active?'Active':'Inactive'}</td><td><button class="button secondary" onclick="adminResetPassword('${u.id}')">Reset Password</button> <button class="button ${u.active?'danger':'secondary'}" onclick="adminToggleUser('${u.id}')">${u.active?'Deactivate':'Activate'}</button></td></tr>`).join('');}
window.adminResetPassword=async id=>{const p=prompt('Enter a new password (minimum 8 characters):');if(p===null)return;const p2=prompt('Enter the same password again:');if(p!==p2){alert('Passwords do not match.');return;}try{await resetLocalPassword(id,p);await markSnapshotDirty();await refreshSnapshotReminder();alert('Password reset successfully.');}catch(e){alert(e.message);}};
window.adminToggleUser=async id=>{const u=await dbGet('users',id);if(!u)return;if(u.id===UI.session.user_id&&u.active){alert('You cannot deactivate the currently logged-in administrator.');return;}u.active=!u.active;u.updated_at=appTimestamp();await dbPut('users',u);await markSnapshotDirty();await renderUsers();await refreshSnapshotReminder();};
async function saveAdminSettings(){try{await setSetting('gps_required',$('gpsRequired').value==='1');await setSetting('image_max_width',Math.max(640,Math.min(4096,Number($('imageMaxWidth').value)||1600)));await setSetting('jpeg_quality',Math.max(.5,Math.min(.95,Number($('jpegQuality').value)||.8)));await setSetting('allow_user_delete',$('allowUserDelete').value==='1');await setSetting('device_code',$('deviceCode').value.trim());await setSetting('device_name',$('deviceName').value.trim());await setSetting('device_location',$('deviceLocation').value.trim());await setSetting('oil_spec',$('oilSpec').value.trim());await markSnapshotDirty();await refreshSnapshotReminder();setMsg($('adminMsg'),'Settings saved locally.','success');}catch(e){setMsg($('adminMsg'),e.message,'error');}}

// Encrypted, offline, single-file backup of everything needed to recover this
// device after a reinstall or factory reset: every local user (with their
// hashed password/verifier, never a plaintext password), device identity and
// settings, the admin recovery code, and the record-ID sequence counter (so
// newly captured records never reuse a display ID from before the reinstall).
// Captured record photos are NOT included here - those already have their
// own capped export flow above and would make this file huge.
async function exportDeviceSnapshot(){
  if(UI.session?.role!=='admin'){alert('Administrator required.');return;}
  const pass=prompt('Create a password to encrypt this Device Snapshot (minimum 8 characters). You will need this exact password to restore the device later — store it somewhere separate from the file itself.');if(pass===null)return;
  const pass2=prompt('Enter the same password again:');if(pass!==pass2){setMsg($('snapshotMsg'),'Passwords do not match.','error');return;}
  try{
    const users=await dbGetAll('users');
    const settingsKeys=['device_uuid','device_code','device_name','device_location','app_name','gps_required','image_max_width','jpeg_quality','allow_user_delete','oil_spec','record_seq_counter','recovery_admin_id','recovery_code_salt','recovery_code_verifier','recovery_created_at'];
    const settings={};for(const k of settingsKeys)settings[k]=await getSetting(k,null);
    const createdAt=appTimestamp();
    const payload={snapshot_version:1,application:'Offline QR Capture',app_version:APP_VERSION,db_schema_version:DB_SCHEMA_VERSION,created_at:createdAt,users,settings};
    const encrypted=await encryptProvisioningPayload(payload,pass,'OfflineQRCaptureDeviceSnapshot');
    downloadBlob(new Blob([JSON.stringify(encrypted,null,2)],{type:'application/json'}),`Offline_QR_DeviceSnapshot_${(await getSetting('device_code','DEVICE')).replace(/[^A-Za-z0-9_-]/g,'_')}_${createdAt.slice(0,10)}.json`);
    await setSetting('snapshot_dirty',false);await setSetting('last_snapshot_at',createdAt);
    setMsg($('snapshotMsg'),`Device Snapshot created with ${users.length} user(s). Store this file and its password somewhere safe, off this tablet.`,'success');
    await refreshSnapshotReminder();
  }catch(e){setMsg($('snapshotMsg'),e.message,'error');}
}

async function exportUsersPackage(){
  if(UI.session?.role!=='admin'){alert('Administrator required.');return;}
  const pass=prompt('Create a password for this user provisioning package (minimum 8 characters):');if(pass===null)return;
  const pass2=prompt('Enter the package password again:');if(pass!==pass2){setMsg($('provisionMsg'),'Package passwords do not match.','error');return;}
  try{const users=await dbGetAll('users');const payload={package_version:1,created_at:appTimestamp(),source_device_uuid:await getSetting('device_uuid',''),source_device_code:await getSetting('device_code',''),app_version:APP_VERSION,db_schema_version:DB_SCHEMA_VERSION,users:users.map(u=>({...u}))};const encrypted=await encryptProvisioningPayload(payload,pass);downloadBlob(new Blob([JSON.stringify(encrypted,null,2)],{type:'application/json'}),`Offline_QR_Users_${(await getSetting('device_code','DEVICE')).replace(/[^A-Za-z0-9_-]/g,'_')}_${appDate()}.json`);setMsg($('provisionMsg'),`Encrypted provisioning package created with ${users.length} user(s).`,'success');}catch(e){setMsg($('provisionMsg'),e.message,'error');}
}
async function importUsersPackage(e){
  if(UI.session?.role!=='admin'){alert('Administrator required.');return;}
  const file=e.target.files?.[0];e.target.value='';if(!file)return;const pass=prompt('Enter the password used to protect this provisioning package:');if(pass===null)return;
  try{const payload=await decryptProvisioningPackage(JSON.parse(await file.text()),pass);if(!Array.isArray(payload.users))throw new Error('Provisioning package does not contain a user list.');let added=0,updated=0,skipped=0;for(const incoming of payload.users){if(!incoming.id||!incoming.user_code||!incoming.username||!incoming.password_salt||!incoming.password_verifier){skipped++;continue;}const byId=await dbGet('users',incoming.id),byCode=await dbGetByIndex('users','user_code',incoming.user_code),byUsername=await dbGetByIndex('users','username',String(incoming.username).toLowerCase()),existing=byId||byCode||byUsername;if(existing){const sameIdentity=existing.user_code===incoming.user_code&&existing.username===String(incoming.username).toLowerCase();if(!sameIdentity){skipped++;continue;}await dbPut('users',{...existing,...incoming,id:existing.id,user_code:existing.user_code,username:existing.username,updated_at:appTimestamp()});updated++;}else{await dbAdd('users',{...incoming,username:String(incoming.username).toLowerCase(),updated_at:appTimestamp()});added++;}}if(added||updated)await markSnapshotDirty();await renderUsers();await refreshSnapshotReminder();setMsg($('provisionMsg'),`Import complete: ${added} added, ${updated} updated, ${skipped} skipped.`,'success');}catch(err){setMsg($('provisionMsg'),err.message,'error');}
}

function registerPWA(){if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();UI.deferredInstall=e;$('installBtn').classList.remove('hidden');});$('installBtn').onclick=async()=>{if(!UI.deferredInstall){alert('Use your browser menu and choose Add to Home Screen / Install App.');return;}UI.deferredInstall.prompt();await UI.deferredInstall.userChoice;UI.deferredInstall=null;$('installBtn').classList.add('hidden');};window.addEventListener('appinstalled',()=>{$('installBtn').classList.add('hidden');});}
document.addEventListener('DOMContentLoaded',()=>init().catch(e=>{document.body.innerHTML=`<main class="shell"><section class="card narrow"><h1>Application Error</h1><p>${esc(e.message)}</p></section></main>`;}));
