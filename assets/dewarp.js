'use strict';

// Cylindrical label un-distortion model.
// Each preset re-samples the ORIGINAL camera frame. Corrections are never stacked.
const CYLINDER_PRESETS = [
  {id:'flat', axis:'v', t:0,   c:0,    label:'Flat / original'},
  {id:'v-t0.7-c0', axis:'v', t:0.7, c:0,    label:'40 deg symmetric'},
  {id:'v-t0.7-c-0.3', axis:'v', t:0.7, c:-0.3, label:'40 deg right-side correction'},
  {id:'v-t0.7-c0.3', axis:'v', t:0.7, c:0.3,  label:'40 deg left-side correction'},
  {id:'v-t1-c0', axis:'v', t:1.0, c:0,    label:'57 deg symmetric'},
  {id:'v-t1-c-0.3', axis:'v', t:1.0, c:-0.3, label:'57 deg right-side correction'},
  {id:'v-t1-c0.3', axis:'v', t:1.0, c:0.3,  label:'57 deg left-side correction'},
  {id:'v-t1.3-c0', axis:'v', t:1.3, c:0,    label:'74 deg symmetric'},
  {id:'v-t1.3-c-0.3', axis:'v', t:1.3, c:-0.3, label:'74 deg right-side correction'},
  {id:'v-t1.3-c0.3', axis:'v', t:1.3, c:0.3,  label:'74 deg left-side correction'}
];

const DEWARP_MAP_CACHE = new Map();

function sourceCoord(u, t, c){
  if(!t || Math.abs(t) < 1e-8) return u;
  const h = 1 - Math.abs(c);
  if(h <= 0) return u;
  const denom = Math.sin(t);
  if(Math.abs(denom) < 1e-8) return u;
  return c + h * Math.sin(t * (u - c) / h) / denom;
}

function getHorizontalMap(width, preset){
  const key = `${width}:${preset.id}`;
  if(DEWARP_MAP_CACHE.has(key)) return DEWARP_MAP_CACHE.get(key);
  const map = new Float32Array(width);
  for(let x=0;x<width;x++){
    const u = width <= 1 ? 0 : (x/(width-1))*2 - 1;
    const s = Math.max(-1, Math.min(1, sourceCoord(u, preset.t, preset.c)));
    map[x] = ((s+1)/2) * (width-1);
  }
  DEWARP_MAP_CACHE.set(key, map);
  return map;
}

function dewarpImageData(input, preset){
  if(preset.id === 'flat') return new ImageData(new Uint8ClampedArray(input.data), input.width, input.height);
  const {width:w,height:h,data:src}=input;
  const out = new Uint8ClampedArray(src.length);
  const map = getHorizontalMap(w,preset);
  for(let y=0;y<h;y++){
    const row = y*w*4;
    for(let x=0;x<w;x++){
      const sx = map[x];
      const x0 = Math.floor(sx);
      const x1 = Math.min(w-1,x0+1);
      const a = sx-x0;
      const i0=row+x0*4, i1=row+x1*4, o=row+x*4;
      out[o]   = src[i0]   + (src[i1]-src[i0])*a;
      out[o+1] = src[i0+1] + (src[i1+1]-src[i0+1])*a;
      out[o+2] = src[i0+2] + (src[i1+2]-src[i0+2])*a;
      out[o+3] = 255;
    }
  }
  return new ImageData(out,w,h);
}
