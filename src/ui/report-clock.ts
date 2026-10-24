'use client';
import {useSyncExternalStore} from 'react';
function subscribe(callback:()=>void){const timer=setInterval(callback,60000);return()=>clearInterval(timer);}
function current(){return Math.floor(Date.now()/60000)*60000;}
export function useReportClock(){return useSyncExternalStore(subscribe,current,()=>0);}
export function reportedState(time:string|null|undefined,now:number){
 if(!time||!Number.isFinite(Date.parse(time))||!now)return 'No current activity verification';
 return now-Date.parse(time)>86400000?'Report is stale; current activity unknown':'Recently reported; ongoing activity unverified';
}
