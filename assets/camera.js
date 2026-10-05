'use strict';
const CAMERA={stream:null,torch:false,facingMode:'environment'};

async function startCamera(video,facingMode=CAMERA.facingMode||'environment'){
  stopCamera();
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera is not supported. Use a modern browser over HTTPS.');
  CAMERA.facingMode=facingMode;
  try{
    CAMERA.stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080},focusMode:{ideal:'continuous'}},
      audio:false
    });
  }catch(err){
    // Some devices (single-camera tablets, some laptop webcams) reject the
    // preferred facingMode/resolution constraints outright. Fall back to
    // whatever camera is available rather than dead-ending the scan screen.
    try{CAMERA.stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}
    catch(err2){throw new Error('Could not access any camera on this device.');}
  }
  video.srcObject=CAMERA.stream;
  await video.play();
  return {torch:cameraTorchSupported(),facingMode:CAMERA.facingMode};
}

async function switchCamera(video){
  const next=CAMERA.facingMode==='environment'?'user':'environment';
  return startCamera(video,next);
}

function stopCamera(){
  if(CAMERA.stream){CAMERA.stream.getTracks().forEach(t=>t.stop());CAMERA.stream=null;CAMERA.torch=false;}
}
function cameraTorchSupported(){const t=CAMERA.stream?.getVideoTracks?.()[0];return Boolean(t?.getCapabilities?.().torch);}
async function setTorch(on){const t=CAMERA.stream?.getVideoTracks?.()[0];if(!t||!cameraTorchSupported())throw new Error('Torch/flash is not supported on this camera.');await t.applyConstraints({advanced:[{torch:Boolean(on)}]});CAMERA.torch=Boolean(on);return CAMERA.torch;}
async function canvasBlob(canvas,quality=.9){return new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Could not create image.')),'image/jpeg',quality));}
async function recompressImageBlob(blob,maxWidth=1600,quality=.8){const bitmap=await createImageBitmap(blob);try{const scale=Math.min(1,maxWidth/bitmap.width);const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=c.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0,c.width,c.height);return canvasBlob(c,quality);}finally{bitmap.close?.();}}
