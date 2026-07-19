const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const ROOT = __dirname;
const tick = (ms=20) => new Promise(r => setTimeout(r, ms));

async function testPageHook() {
  const sent=[];
  class FakeResponse { constructor(data){this.ok=true;this.data=data} clone(){return this} async json(){return this.data} }
  const result={data:{create_tweet:{tweet_results:{result:{rest_id:'123456789',legacy:{full_text:'hello square'},core:{user_results:{result:{legacy:{screen_name:'alice'}}}}}}}}};
  const window={location:{origin:'https://x.com'},postMessage:m=>sent.push(m),fetch:async()=>new FakeResponse(result)};
  const context={window,URLSearchParams,XMLHttpRequest:undefined};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'page-hook.js'),'utf8'),context);
  let unrelatedBodyRead = false;
  const unrelatedInit = {};
  Object.defineProperty(unrelatedInit, 'body', {get(){unrelatedBodyRead = true; throw new Error('unrelated body was inspected');}});
  await window.fetch('https://x.com/i/api/graphql/id/HomeTimeline', unrelatedInit);
  assert.equal(unrelatedBodyRead, false, 'unrelated X request bodies must not be inspected');
  await window.fetch('https://x.com/i/api/graphql/id/CreateTweet',{body:JSON.stringify({variables:{tweet_text:'hello square'}})});
  await tick();
  assert.equal(sent.length,1);
  assert.equal(sent[0].payload.event_id,'x:123456789');
  assert.equal(sent[0].payload.username,'alice');

  sent.length=0;
  await window.fetch('https://x.com/i/api/graphql/id/CreateTweet',{body:JSON.stringify({variables:{tweet_text:'quote text',attachment_url:'https://x.com/source/status/9'}})});
  await tick();
  assert.equal(sent.length,1,'quote post must be synchronized');

  sent.length=0;
  await window.fetch('https://x.com/i/api/graphql/id/CreateTweet',{body:JSON.stringify({variables:{tweet_text:'reply',reply:{in_reply_to_tweet_id:'1'}}})});
  await tick();
  assert.equal(sent.length,0,'reply must be ignored');
}

async function testServiceWorker() {
  const data={squareApiKey:'user-square-key-1234567890',enabled:true};
  const listeners={};
  let fetchCount=0, lastHeaders=null, riskNext=false, rejectNext=null;
  const requestBodies=[];
  const chrome={
    storage:{local:{
      async get(keys){if(typeof keys==='string') return {[keys]:data[keys]}; const out={}; for(const k of keys||Object.keys(data)) out[k]=data[k]; return out;},
      async set(values){Object.assign(data,values);},
      async remove(key){delete data[key];}
    }},
    runtime:{
      onMessage:{addListener(fn){listeners.message=fn}},
      onInstalled:{addListener(fn){listeners.installed=fn}},
      onStartup:{addListener(fn){listeners.startup=fn}},
      async openOptionsPage(){}
    },
    alarms:{async create(){},onAlarm:{addListener(fn){listeners.alarm=fn}}},
    action:{async setBadgeText(){},async setBadgeBackgroundColor(){}}
  };
  const context={chrome,console,setTimeout,clearTimeout,fetch:async(_url,opts)=>{
    fetchCount++;
    lastHeaders=opts.headers;
    requestBodies.push(JSON.parse(opts.body).bodyTextOnly);
    if(riskNext){riskNext=false;return {ok:true,status:200,async json(){return {code:'20041',message:'Potential security risk with the URL'}}};}
    if(rejectNext){const code=rejectNext;rejectNext=null;return {ok:true,status:200,async json(){return {code,message:'Rejected by Binance'}}};}
    return {ok:true,status:200,async json(){return {code:'000000',data:{id:'sq123'}}}};
  }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8'),context);
  async function runtimeMessage(message){return new Promise(resolve=>listeners.message(message,null,resolve));}
  async function message(payload){return runtimeMessage({type:'QUEUE_X_POST',payload});}
  const payload={event_id:'x:1',tweet_id:'1',username:'Alice',text:'hello',source_url:'https://x.com/Alice/status/1'};
  assert.deepEqual(await message(payload),{ok:true});
  assert.equal(fetchCount,1);
  assert.equal(lastHeaders['X-Square-OpenAPI-Key'],'user-square-key-1234567890');
  assert.equal(data.boundUsername,'alice');
  assert.equal(data.queue['x:1'].status,'published');
  await message(payload);
  assert.equal(fetchCount,1,'same tweet must not publish twice');
  const ignored=await message({...payload,event_id:'x:2',tweet_id:'2',username:'Bob'});
  assert.equal(ignored.ignored,true);
  assert.equal(fetchCount,1,'different X account must be ignored after binding');

  riskNext=true;
  const linked={...payload,event_id:'x:3',tweet_id:'3',text:'项目地址 https://example.com/path\n正文保留'};
  assert.deepEqual(await message(linked),{ok:true});
  assert.equal(fetchCount,3,'URL risk must retry exactly once');
  assert.equal(requestBodies.at(-2),'项目地址 https://example.com/path\n正文保留');
  assert.equal(requestBodies.at(-1),'项目地址\n正文保留');
  assert.equal(data.queue['x:3'].status,'published');
  assert.equal(data.queue['x:3'].links_removed,true);
  assert.equal(data.lastStatus.links_removed,true);

  rejectNext='20002';
  const rejected={...payload,event_id:'x:4',tweet_id:'4',text:'被拒正文 https://risky.example/path'};
  assert.deepEqual(await message(rejected),{ok:true});
  assert.equal(data.queue['x:4'].status,'blocked');
  assert.equal(data.queue['x:4'].error_code,'20002');
  assert.ok(data.queue['x:4'].rejected_at);
  assert.equal(data.lastStatus.ok,false);
  assert.equal(data.lastStatus.status,'blocked');
  assert.equal(data.lastStatus.error_code,'20002');

  const retried=await runtimeMessage({type:'RETRY_WITHOUT_LINKS'});
  assert.equal(retried.ok,true);
  assert.equal(retried.links_removed_count,1);
  assert.equal(requestBodies.at(-1),'被拒正文');
  assert.equal(data.queue['x:4'].status,'published');
  assert.equal(data.queue['x:4'].links_removed,true);
  assert.equal(data.lastStatus.links_removed,true);

  data.queue['x:5']={payload:{...payload,event_id:'x:5',tweet_id:'5',text:'https://only.example/path'},status:'blocked',attempts:1,created_at:Date.now()};
  const beforeUrlOnly=fetchCount;
  const emptyRetry=await runtimeMessage({type:'RETRY_WITHOUT_LINKS'});
  assert.equal(emptyRetry.skipped_empty_count,1);
  assert.equal(fetchCount,beforeUrlOnly,'URL-only content must never be sent empty');
  assert.equal(data.queue['x:5'].status,'blocked');
}

(async()=>{await testPageHook();await testServiceWorker();console.log('extension simulations: PASS');})().catch(e=>{console.error(e);process.exit(1)});
