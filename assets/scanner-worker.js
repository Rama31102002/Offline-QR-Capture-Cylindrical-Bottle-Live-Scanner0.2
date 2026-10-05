'use strict';
importScripts('./dewarp.js','./label-schema.js');

let detector = null;
let supported = false;
const winnerOrder = [];

async function ensureDetector(){
  if(detector) return true;
  if(typeof BarcodeDetector === 'undefined') return false;
  try{
    const formats = await BarcodeDetector.getSupportedFormats?.();
    if(formats?.length && !formats.includes('qr_code')) return false;
    detector = new BarcodeDetector({formats:['qr_code']});
    supported = true;
    return true;
  }catch{
    return false;
  }
}

function uniqueValues(found){
  const out=[];
  for(const item of found||[]){
    const value=String(item?.rawValue||item?.value||'').trim();
    if(value && !out.includes(value)) out.push(value);
  }
  return out;
}

function orderedPresets(){
  const promoted=[];
  for(const id of winnerOrder){
    const p=CYLINDER_PRESETS.find(x=>x.id===id);
    if(p && !promoted.some(x=>x.id===p.id)) promoted.push(p);
  }
  for(const p of CYLINDER_PRESETS){
    if(!promoted.some(x=>x.id===p.id)) promoted.push(p);
  }
  return promoted;
}

function rememberWinner(id){
  const i=winnerOrder.indexOf(id);
  if(i>=0) winnerOrder.splice(i,1);
  winnerOrder.unshift(id);
  if(winnerOrder.length>4) winnerOrder.length=4;
}

self.onmessage = async e => {
  if(e.data?.type !== 'scan-frame') return;
  const {frameId, sessionId, bitmap} = e.data;
  const started=performance.now();
  try{
    if(!(await ensureDetector())){
      bitmap?.close?.();
      self.postMessage({type:'unsupported',frameId,sessionId});
      return;
    }
    const w=bitmap.width,h=bitmap.height;
    const base=new OffscreenCanvas(w,h);
    const bctx=base.getContext('2d',{alpha:false,willReadFrequently:true});
    bctx.drawImage(bitmap,0,0,w,h);
    bitmap.close?.();
    const original=bctx.getImageData(0,0,w,h);
    const pooled=[];
    const hits=[];
    let foundA=false,foundB=false;
    let checked=0;

    for(const preset of orderedPresets()){
      checked++;
      const pStart=performance.now();
      const candidateData=dewarpImageData(original,preset);
      const c=new OffscreenCanvas(w,h);
      const ctx=c.getContext('2d',{alpha:false});
      ctx.putImageData(candidateData,0,0);
      let found=[];
      try{found=await detector.detect(c);}catch{}
      const values=uniqueValues(found);
      for(const value of values){
        if(!pooled.includes(value)){
          pooled.push(value);
          const classified=classifyLabelPayload(value);
          hits.push({value,preset:preset.id,label_type:classified?.type||null,elapsed_ms:Math.round(performance.now()-started)});
          if(classified?.type==='A')foundA=true;
          if(classified?.type==='B')foundB=true;
          if(classified)rememberWinner(preset.id);
        }
      }
      if(foundA&&foundB) break;
      // Ensure extremely slow candidates do not block forever on one frame.
      if(performance.now()-pStart>900) break;
    }

    self.postMessage({
      type:'scan-result',frameId,sessionId,values:pooled,hits,checked,
      elapsed_ms:Math.round(performance.now()-started),
      winner_order:[...winnerOrder]
    });
  }catch(err){
    bitmap?.close?.();
    self.postMessage({type:'scan-error',frameId,sessionId,message:String(err?.message||err)});
  }
};
