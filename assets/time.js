'use strict';
// One authoritative application timezone. All user-facing dates/times and
// capture grouping use this zone so the dashboard and stored capture_date can
// never disagree around UTC midnight.
const APP_TIME_ZONE='Asia/Kolkata';
function appDateParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:APP_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const m={}; for(const p of parts) if(p.type!=='literal') m[p.type]=p.value;
  return m;
}
function appDate(date=new Date()){const p=appDateParts(date);return `${p.year}-${p.month}-${p.day}`;}
function appTime(date=new Date()){const p=appDateParts(date);return `${p.hour}:${p.minute}:${p.second}`;}
function appTimestamp(date=new Date()){return `${appDate(date)}T${appTime(date)}+05:30`;}
function appFilenameStamp(date=new Date()){return `${appDate(date)}T${appTime(date).replaceAll(':','-')}`;}
