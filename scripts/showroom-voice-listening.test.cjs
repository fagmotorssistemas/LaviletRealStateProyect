const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path')
// Exercises the actual recognition callbacks with a simulated browser, not a microphone.
function harness(locale='es'){
 const source=fs.readFileSync(path.join(__dirname,'../src/components/tour/TourVoiceAssist.tsx'),'utf8')
 const callbacks=source.slice(source.indexOf('  const resumeQuietListening ='),source.indexOf('  const startListening ='))
 const timers=[],recognizers=[],texts=[];let restarts=0
 const ref=value=>({current:value})
 class Recognition{constructor(){recognizers.push(this)}start(){}}
 const context={locale,window:{setTimeout:fn=>timers.push(fn)},getSpeechRecognitionCtor:()=>Recognition,
 startingListenRef:ref(false),recognitionRef:ref(null),ignoreSpeechErrorRef:ref(false),turnRef:ref(1),conversationRef:ref(true),openRef:ref(true),typingRef:ref(false),textDraftRef:ref(''),
 setError(){},setPhase(){},stopSpokenAudio(){},startListening:()=>{restarts++},handleUserText:text=>texts.push(text)}
 vm.createContext(context);vm.runInContext(ts.transpile(callbacks+'\nglobalThis.start=startSpeechRecognition;', {target:ts.ScriptTarget.ES2022}),context)
 return {context,timers,recognizers,texts,start:()=>context.start(),restarts:()=>restarts}
}
test('silence re-arms listening without generating a spoken reply',async()=>{
 const h=harness();await h.start();h.recognizers[0].onerror({error:'no-speech'});h.recognizers[0].onend()
 assert.equal(h.timers.length,1);h.timers.shift()();assert.equal(h.restarts(),1);assert.deepEqual(h.texts,[])
})

test('recognition uses English when the showroom language is English',async()=>{
 const h=harness('en');await h.start();assert.equal(h.recognizers[0].lang,'en-US')
})
test('paused conversation cancels queued listening and stale recognizer cannot replace active one',async()=>{
 const h=harness();await h.start();const old=h.recognizers[0];old.onend();h.context.conversationRef.current=false;h.timers.shift()();assert.equal(h.restarts(),0)
 h.context.conversationRef.current=true;await h.start();old.onend();assert.equal(h.context.recognitionRef.current,h.recognizers[1])
})
test('final speech is submitted once; permission failure does not restart',async()=>{
 const h=harness();await h.start();const r=h.recognizers[0],row=[{transcript:'quiero dos dormitorios'}];row.isFinal=true
 r.onresult({resultIndex:0,results:[row]});r.onend();assert.deepEqual(h.texts,['quiero dos dormitorios']);assert.equal(h.timers.length,0)
 await h.start();h.recognizers[1].onerror({error:'not-allowed'});h.recognizers[1].onend();assert.equal(h.timers.length,0)
})
