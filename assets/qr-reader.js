'use strict';

function classifyFrameValues(values,hits=[]){
  let A=null,B=null;
  for(const value of [...new Set((values||[]).map(v=>String(v||'').trim()).filter(Boolean))]){
    const a=parseLabelA(value),b=parseLabelB(value);
    const hit=hits.find(x=>x.value===value)||{};
    if(a&&!A)A={...a,schema_version:QR_SCHEMA_VERSION,scan_preset:hit.preset||null};
    if(b&&!B)B={...b,schema_version:QR_SCHEMA_VERSION,scan_preset:hit.preset||null};
  }
  return {labelA:A,labelB:B,complete:Boolean(A&&B)};
}

const ANALYSIS_EDGE=1080;   // long edge sent to the decoder/worker
const FULL_RES_EDGE=2560;   // long edge kept in case this frame turns out to be the winner

const LIVE_QR={
  worker:null,
  running:false,
  busy:false,
  frameId:0,
  timer:null,
  startedAt:0,
  onStatus:null,
  onSuccess:null,
  onError:null,
  fallbackDetector:null,
  preferred:[],
  lastWatchdogMessage:0,
  // The full-resolution snapshot of the frame currently being analyzed by the
  // worker/detector. Because scanning is strictly serialized (see `busy`
  // below), there is at most one of these in flight at any time.
  pendingFrame:null,
  sessionId:0
};

function stopLiveQRScanner(){
  LIVE_QR.running=false;
  LIVE_QR.busy=false;
  LIVE_QR.sessionId++;
  LIVE_QR.pendingFrame=null;
  if(LIVE_QR.timer){clearTimeout(LIVE_QR.timer);LIVE_QR.timer=null;}
  if(LIVE_QR.worker){LIVE_QR.worker.terminate();LIVE_QR.worker=null;}
}

function scannerStatus(payload){try{LIVE_QR.onStatus?.(payload);}catch{}}

// Grabs ONE snapshot of the current live video frame at full resolution.
// This is the single source of truth for a given instant: the smaller
// analysis copy sent to the decoder is always derived FROM this canvas
// (see scanNext), never captured separately - so the frame that gets
// decoded and the frame that gets saved can never drift apart.
function captureFrameCanvas(video,maxLongEdge=FULL_RES_EDGE){
  const vw=video.videoWidth,vh=video.videoHeight;
  if(!vw||!vh) throw new Error('Camera frame is not ready.');
  const scale=Math.min(1,maxLongEdge/Math.max(vw,vh));
  const w=Math.max(1,Math.round(vw*scale)),h=Math.max(1,Math.round(vh*scale));
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d',{alpha:false}).drawImage(video,0,0,w,h);
  return c;
}

function canvasToJpegBlob(canvas,quality=.92){
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not preserve successful frame.')),'image/jpeg',quality));
}

// Derives the smaller bitmap handed to the decoder from the SAME full-res
// canvas that gets cached as `pendingFrame`, instead of re-sampling the
// (possibly already-moved-on) live video a second time.
async function deriveAnalysisBitmap(fullCanvas,maxLongEdge=ANALYSIS_EDGE){
  const vw=fullCanvas.width,vh=fullCanvas.height;
  const scale=Math.min(1,maxLongEdge/Math.max(vw,vh));
  const w=Math.max(1,Math.round(vw*scale)),h=Math.max(1,Math.round(vh*scale));
  return createImageBitmap(fullCanvas,{resizeWidth:w,resizeHeight:h,resizeQuality:'high'});
}

function startLiveQRScanner(video,{onStatus,onSuccess,onError,intervalMs=70}={}){
  stopLiveQRScanner();
  LIVE_QR.running=true;LIVE_QR.startedAt=performance.now();
  const sessionId=LIVE_QR.sessionId;LIVE_QR.onStatus=onStatus;LIVE_QR.onSuccess=onSuccess;LIVE_QR.onError=onError;
  let worker;
  try{worker=new Worker('assets/scanner-worker.js');LIVE_QR.worker=worker;}catch(err){worker=null;}

  const schedule=(delay=intervalMs)=>{
    if(!LIVE_QR.running||sessionId!==LIVE_QR.sessionId)return;
    LIVE_QR.timer=setTimeout(scanNext,delay);
  };

  const handleResult=async result=>{
    if(!LIVE_QR.running||sessionId!==LIVE_QR.sessionId||result.sessionId!==sessionId)return;
    LIVE_QR.busy=false;
    // The pending frame is guaranteed (by the `busy` gate below, which
    // prevents a second frame from ever being captured before this one's
    // result comes back) to be the exact frame `result` was decoded from.
    const matchedFrame=LIVE_QR.pendingFrame&&LIVE_QR.pendingFrame.frameId===result.frameId?LIVE_QR.pendingFrame.canvas:null;
    LIVE_QR.pendingFrame=null;
    const classified=classifyFrameValues(result.values,result.hits);
    scannerStatus({
      labelA:Boolean(classified.labelA),labelB:Boolean(classified.labelB),
      elapsed_ms:result.elapsed_ms||0,checked:result.checked||0,
      message:classified.complete?'Both labels detected.':classified.labelA?'Label A detected. Searching for Label B...':classified.labelB?'Label B detected. Searching for Label A...':'Scanning bottle...'
    });
    if(classified.complete){
      try{
        // Preserve the ORIGINAL frame that was actually decoded, not a fresh
        // (and by now, potentially different) grab off the live video.
        if(!matchedFrame){
          scannerStatus({labelA:false,labelB:false,message:'Successful QR result arrived without its matching evidence frame. Scanning continues for a verified frame.'});
          schedule(0);
          return;
        }
        const originalBlob=await canvasToJpegBlob(matchedFrame);
        stopLiveQRScanner();
        navigator.vibrate?.(120);
        LIVE_QR.onSuccess?.({
          labelA:classified.labelA,labelB:classified.labelB,
          capturedBlob:originalBlob,
          scan_duration_ms:Math.round(performance.now()-LIVE_QR.startedAt),
          candidates_checked:result.checked||0,
          worker_elapsed_ms:result.elapsed_ms||0
        });
      }catch(err){LIVE_QR.onError?.(err);}
      return;
    }
    const now=performance.now();
    if(now-LIVE_QR.startedAt>4000 && now-LIVE_QR.lastWatchdogMessage>3500){
      LIVE_QR.lastWatchdogMessage=now;
      scannerStatus({labelA:Boolean(classified.labelA),labelB:Boolean(classified.labelB),message:'Still scanning. Keep both QR labels visible, reduce glare, and hold the bottle steady.'});
    }
    schedule();
  };

  if(worker){
    worker.onmessage=e=>{
      const d=e.data||{};
      if(d.sessionId!==sessionId)return;
      if(d.type==='scan-result')handleResult(d);
      else if(d.type==='unsupported'){
        worker.terminate();LIVE_QR.worker=null;worker=null;LIVE_QR.busy=false;LIVE_QR.pendingFrame=null;
        schedule(0);
      }else if(d.type==='scan-error'){
        LIVE_QR.busy=false;LIVE_QR.pendingFrame=null;scannerStatus({message:'Scanner recovered from a frame-processing error and is continuing.'});schedule(100);
      }
    };
    worker.onerror=()=>{try{worker.terminate();}catch{} LIVE_QR.worker=null;worker=null;LIVE_QR.busy=false;LIVE_QR.pendingFrame=null;schedule(0);};
  }

  async function fallbackScan(bitmap){
    if(!('BarcodeDetector' in window)) throw new Error('QR scanning is not supported by this browser. Use the latest Chrome on Android.');
    if(!LIVE_QR.fallbackDetector)LIVE_QR.fallbackDetector=new BarcodeDetector({formats:['qr_code']});
    const found=await LIVE_QR.fallbackDetector.detect(bitmap);
    bitmap.close?.();
    return {values:(found||[]).map(x=>x.rawValue).filter(Boolean),hits:[],checked:1,elapsed_ms:0};
  }

  async function scanNext(){
    if(!LIVE_QR.running||sessionId!==LIVE_QR.sessionId||LIVE_QR.busy)return;
    if(video.readyState<2||!video.videoWidth){schedule(120);return;}
    LIVE_QR.busy=true;
    try{
      // Grab ONE snapshot of "now" and derive the decoder's copy from it, so
      // whatever gets decoded and whatever gets saved are always the same frame.
      const fullCanvas=captureFrameCanvas(video);
      const frameId=++LIVE_QR.frameId;
      LIVE_QR.pendingFrame={frameId,canvas:fullCanvas};
      const bitmap=await deriveAnalysisBitmap(fullCanvas);
      if(worker){worker.postMessage({type:'scan-frame',frameId,sessionId,bitmap},[bitmap]);}
      else{const result=await fallbackScan(bitmap);await handleResult({...result,frameId,sessionId});}
    }catch(err){LIVE_QR.busy=false;LIVE_QR.pendingFrame=null;scannerStatus({message:'Waiting for a clear camera frame...'});schedule(150);}
  }

  scannerStatus({labelA:false,labelB:false,message:'Scanning bottle... Keep both QR labels in view.'});
  schedule(0);
}
