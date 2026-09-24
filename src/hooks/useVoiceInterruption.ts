'use client'
import { useEffect, useRef } from 'react'
/** Observe only during an active spoken turn. Echo cancellation is requested;
 * real device/acoustic validation is still required. No audio is uploaded here. */
export function useVoiceInterruption(enabled:boolean,onSpeech:()=>void){
 const callback=useRef(onSpeech)
 useEffect(()=>{callback.current=onSpeech},[onSpeech])
 useEffect(()=>{
  if(!enabled || !navigator.mediaDevices?.getUserMedia)return
  let disposed=false,stream:MediaStream|null=null,context:AudioContext|null=null,frame=0
  void navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}).then(async media=>{
   if(disposed){media.getTracks().forEach(t=>t.stop());return}
   stream=media;context=new AudioContext();await context.resume()
   if(disposed)return
   const analyser=context.createAnalyser();analyser.fftSize=1024
   context.createMediaStreamSource(media).connect(analyser)
   const samples=new Float32Array(analyser.fftSize);let start=0
   const tick=()=>{if(disposed)return;analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length)
    if(rms>0.035){if(!start)start=performance.now();if(performance.now()-start>=120){callback.current();return}}else start=0
    frame=requestAnimationFrame(tick)
   };frame=requestAnimationFrame(tick)
  }).catch(()=>{/* Visible manual interrupt remains available if monitoring is denied. */})
  return()=>{disposed=true;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());void context?.close().catch(()=>undefined)}
 },[enabled])
}
