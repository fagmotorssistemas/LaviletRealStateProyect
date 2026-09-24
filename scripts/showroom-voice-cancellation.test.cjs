// Simulated audio/network only. Does not validate a real microphone or acoustic echo.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path')
test('interrupt stops active playback, cancels prefetched speech and discards late audio',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/components/tour/TourVoiceAssist.tsx'),'utf8')+'\nexport const audioTest={speakText,stopSpokenAudio};'
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
 const requests=[],players=[]
 class Audio{constructor(){players.push(this)}play(){this.played=true;return Promise.resolve()}pause(){this.paused=true}}
 const context={exports:{},require:id=>id==='@/lib/tour/voiceAssist'?{splitSpeakChunks:text=>text.split('|')}:{},window:{speechSynthesis:{cancel(){}}},Audio,Blob,URL,AbortController,atob,Uint8Array,console,
  fetch:(_url,options)=>new Promise(resolve=>requests.push({options,resolve}))}
 vm.runInNewContext(code,context)
 const {speakText,stopSpokenAudio}=context.exports.audioTest
 const pending=speakText('first|second')
 assert.equal(requests.length,1)
 requests[0].resolve({ok:true,blob:async()=>new Blob(['audio'])})
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(players.length,1);assert.equal(players[0].played,true);assert.equal(requests.length,2)
 stopSpokenAudio();assert.equal(players[0].paused,true);assert.equal(requests[1].options.signal.aborted,true)
 requests[1].resolve({ok:true,blob:async()=>new Blob(['late'])})
 await pending;assert.equal(players.length,1)
 const next=speakText('third');stopSpokenAudio()
 requests[2].resolve({ok:true,blob:async()=>new Blob(['late third'])})
 await next;assert.equal(players.length,1)
})
