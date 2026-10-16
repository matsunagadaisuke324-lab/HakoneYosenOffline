import {firebaseConfig} from './firebase-config.js';
// Firebase SDK is loaded only when online features are requested.
// This keeps the collector and IndexedDB available after an offline restart.
let initializeApp, getAuth, signInAnonymously;
let getFirestore, doc, collection, onSnapshot, serverTimestamp, runTransaction;
const UNIVERSITIES=['中央学院','東海','神奈川','東洋','日本体育','東京国際','山梨学院','東京農業','大東文化','立教','法政','明治','専修','国士舘'];
const $=id=>document.getElementById(id), KEY='hakone-offline-session-v1';
const uuid=()=>crypto.randomUUID?.()||('id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const validRace=s=>/^[A-Za-z0-9_-]{1,80}$/.test(s);
const nextRaceId=old=>{const base=old.replace(/-run-[a-z0-9-]+$/,'').slice(0,52);return `${base}-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`};
const fmt=ms=>{let v=Math.max(0,Math.round(ms/100));let m=Math.floor(v/600),s=Math.floor((v%600)/10),t=v%10;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`};
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initSession=()=>({raceId:'hakone-yosen-2026',university:'中央学院',referenceUniversity:'山梨学院',measurementId:uuid(),deviceId:uuid(),started:false,startWall:0,records:[],revision:0,sentRevision:0});
let session=initSession(),db=null,auth=null,unsub=null,boardRows=[],boardCorrections={},boardWatchedRace='',boardGeneration=0;
const openDB=()=>new Promise((res,rej)=>{const r=indexedDB.open('hakone-offline-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function idbGet(k){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction('data','readonly'),r=t.objectStore('data').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);t.oncomplete=()=>d.close()})}
async function idbSet(k,v){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction('data','readwrite');t.objectStore('data').put(v,k);t.oncomplete=()=>{d.close();res()};t.onerror=()=>rej(t.error)})}
async function persist(){await idbSet(KEY,session);$('storageStatus').textContent='端末内に保存済み（'+new Date().toLocaleTimeString()+'）'}
function fillSelect(id){$(id).innerHTML=UNIVERSITIES.map(n=>`<option value="${n}">${n}</option>`).join('')}
function render(){ $('raceId').value=session.raceId;$('collectorRaceStatus').textContent='送信先レースID：'+session.raceId;$('university').value=session.university;$('referenceUniversity').value=session.referenceUniversity;for(const id of ['raceId','university','referenceUniversity'])$(id).disabled=session.started;$('referenceBtn').disabled=session.started;$('goalBtn').disabled=!session.started;$('count').textContent=`${session.records.length} / 10人`;$('state').textContent=session.started?'計測中':'基準GOAL待ち';$('sendBtn').disabled=session.records.length!==10||session.sentRevision===session.revision;$('sendBtn').textContent=session.sentRevision===session.revision&&session.revision>0?'送信済み':'10人分をFirebaseに送信';$('records').innerHTML=session.records.map((r,i)=>`<li>${i+1}人目　+${fmt(r.elapsedMs)} <button data-edit="${i}">修正</button> <button data-delete="${i}">削除</button></li>`).join('');if(session.sentRevision===session.revision&&session.revision>0)$('sendStatus').textContent='この版は送信済みです。';}
function timeMs(){if(!session.started)return 0;return Math.max(0,Date.now()-session.startWall)}
let anchorPerf=null;function tick(){if(session.started){let elapsed=anchorPerf!==null?performance.now()-anchorPerf:timeMs();$('timer').textContent=fmt(elapsed)}else $('timer').textContent='00:00.0';requestAnimationFrame(tick)}
async function record(ms){if(session.records.length>=10){alert('10人分の記録が揃っています。修正する場合は履歴から操作してください。');return}session.records.push({elapsedMs:Math.max(0,Math.round(ms))});session.revision++;try{await persist()}catch(e){alert('保存に失敗しました。端末の空き容量・プライベートブラウズ設定を確認してください。'+e.message)}render()}
async function start(){if(session.started)return;if(!validRace($('raceId').value.trim()))return alert('レースIDは半角英数字、-、_ のみで80文字以内にしてください。');session.raceId=$('raceId').value.trim();session.university=$('university').value;session.referenceUniversity=$('referenceUniversity').value;session.startWall=Date.now();anchorPerf=performance.now();session.started=true;if(session.university===session.referenceUniversity){session.records=[{elapsedMs:0}];session.revision++}try{await persist()}catch(e){session.started=false;return alert('保存できないため計測を開始できません。'+e.message)}render()}
async function saveSettings(){if(session.started)return;const next=$('raceId').value.trim();if(!validRace(next)){ $('collectorRaceStatus').textContent='レースIDは半角英数字・-・_で1～80文字';return }session.raceId=next;session.university=$('university').value;session.referenceUniversity=$('referenceUniversity').value;await persist();$('collectorRaceStatus').textContent='送信先レースID：'+session.raceId;}
function csvDownload(name,rows){const csv='\ufeff'+rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function ownCSV(){csvDownload(`${session.raceId}-${session.university}.csv`,[['raceId','大学','記録順','全体1位との差(ms)','表示タイム'],...session.records.map((r,i)=>[session.raceId,session.university,i+1,r.elapsedMs,fmt(r.elapsedMs)])])}
let fbReady=null;
async function connectFirebase(){
  if(fbReady)return fbReady;
  fbReady=(async()=>{
    if(firebaseConfig.apiKey==='REPLACE_ME')throw Error('firebase-config.js の設定が未完了です');
    if(!navigator.onLine)throw Error('オフラインのためFirebaseに接続できません');
    const [appSdk,authSdk,firestoreSdk]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
    ]);
    ({initializeApp}=appSdk);
    ({getAuth,signInAnonymously}=authSdk);
    ({getFirestore,doc,collection,onSnapshot,serverTimestamp,runTransaction}=firestoreSdk);
    const app=initializeApp(firebaseConfig);
    db=getFirestore(app);
    auth=getAuth(app);
    await signInAnonymously(auth);
    return db;
  })();
  try{return await fbReady}catch(e){fbReady=null;throw e}
}
async function send(){if(session.records.length!==10)return alert('10人分揃っていません');if(!navigator.onLine)return alert('現在オフラインです。電波の良い場所で再試行してください。');const button=$('sendBtn');button.disabled=true;$('sendStatus').textContent='送信中…';try{await connectFirebase();const revision=session.revision;const payload={raceId:session.raceId,university:session.university,measurementId:session.measurementId,deviceId:session.deviceId,referenceUniversity:session.referenceUniversity,runners:session.records.map((r,i)=>({order:i+1,elapsedMs:r.elapsedMs})),revision,updatedAt:serverTimestamp()};const ref=doc(db,'offlineRaces',session.raceId,'submissions',session.university);await runTransaction(db,async tx=>{const old=await tx.get(ref);if(old.exists()){const prev=old.data();if(prev.measurementId!==session.measurementId)throw Error('この大学には別端末からの送信が登録済みです。誤上書きを防止しました。本部に確認してください。');if(prev.revision>revision)throw Error('サーバー側に新しい修正版があります。')}tx.set(ref,payload)});session.sentRevision=revision;await persist();$('sendStatus').textContent='Firebaseへの送信が完了しました。';render()}catch(e){$('sendStatus').textContent='送信失敗：'+e.message;render()}}
function correctionKey(r,u){return `correction:${r}:${u}`}
function getCorrection(r,u){return Number(localStorage.getItem(correctionKey(r,u))||0)}
function renderBoard(){const race=$('boardRaceId').value.trim();const map=new Map(boardRows.map(x=>[x.university,x]));const data=UNIVERSITIES.map(u=>{const d=map.get(u);const complete=d?.runners?.length===10;const correction=getCorrection(race,u);const sum=complete?d.runners.reduce((s,r)=>s+Number(r.elapsedMs),0)+correction*10:null;return {u,d,complete,correction,sum}});const ranked=data.filter(x=>x.complete).sort((a,b)=>a.sum-b.sum);const rankMap=new Map(ranked.map((x,i)=>[x.u,i+1]));$('rankBody').innerHTML=data.sort((a,b)=>(a.complete?0:1)-(b.complete?0:1)||(a.complete? a.sum-b.sum:UNIVERSITIES.indexOf(a.u)-UNIVERSITIES.indexOf(b.u))).map(x=>`<tr><td>${x.complete?rankMap.get(x.u):'—'}</td><td>${escapeHtml(x.u)}</td><td>${x.d?.runners?.length||0}/10</td><td>${x.complete?'+'+fmt(x.sum):'—'}</td><td><input type="number" step="1" data-correction="${escapeHtml(x.u)}" value="${x.correction}" aria-label="${escapeHtml(x.u)} 基準補正ミリ秒"></td><td>${x.complete?'受信済み':'未受信'}</td></tr>`).join('');}
function resetBoardView(message='レースIDが変更されました。集計を読み込みます。'){
  boardGeneration++;
  if(unsub){unsub();unsub=null}
  boardWatchedRace='';boardRows=[];
  renderBoard();$('boardStatus').textContent=message;
}
async function watchBoard(){
  const race=$('boardRaceId').value.trim();
  if(!validRace(race))return alert('レースIDを確認してください');
  resetBoardView('接続中…');
  const generation=boardGeneration;
  try{
    await connectFirebase();
    if(generation!==boardGeneration)return;
    boardWatchedRace=race;
    unsub=onSnapshot(collection(db,'offlineRaces',race,'submissions'),snap=>{
      if(generation!==boardGeneration||$('boardRaceId').value.trim()!==race)return;
      boardRows=snap.docs.map(d=>d.data());
      $('boardStatus').textContent=`接続中：${boardRows.length}大学から受信（${new Date().toLocaleTimeString()}）`;
      renderBoard();
    },e=>{if(generation===boardGeneration)$('boardStatus').textContent='受信エラー：'+e.message});
  }catch(e){if(generation===boardGeneration)$('boardStatus').textContent='接続できません：'+e.message}
}
async function resetMeasurement(newRace){
  const message=newRace?'新しいレースIDを発行し、端末内の現在の記録を消去します。必要なら先にCSV保存してください。続けますか？':'同じレースIDで新しい計測を始めます。端末内の現在の記録を消去します。必要なら先にCSV保存してください。続けますか？';
  if(!confirm(message))return;
  const old=session;
  const next=initSession();
  next.raceId=newRace?nextRaceId(old.raceId):old.raceId;
  next.university=old.university;
  next.referenceUniversity=old.referenceUniversity;
  // Keep the device identity, but create a new measurement identity for each measurement.
  next.deviceId=old.deviceId;
  try{await idbSet(KEY,next)}catch(e){return alert('記録の初期化に失敗しました。元の記録は保持されています。'+e.message)}
  session=next;anchorPerf=null;
  $('storageStatus').textContent='端末内に保存済み（'+new Date().toLocaleTimeString()+'）';
  $('sendStatus').textContent=newRace?'新しいレースID：'+next.raceId+'。全担当者と本部で共有してください。':'同じレースIDで新しい計測を開始できます。送信済みの同大学データがある場合、新しい計測IDでの上書きは拒否されます。';
  render();
  $('boardRaceId').value=next.raceId;
  resetBoardView();
  if(!$('board').hidden)await watchBoard();
}
function boardCSV(){const race=$('boardRaceId').value.trim();csvDownload(`${race}-ranking.csv`,[['大学','受信人数','基準補正ms','10人合計差ms'],...UNIVERSITIES.map(u=>{const d=boardRows.find(x=>x.university===u),c=getCorrection(race,u);return[u,d?.runners?.length||0,c,d?.runners?.length===10?d.runners.reduce((s,r)=>s+r.elapsedMs,0)+c*10:'']})])}
async function setup(){fillSelect('university');fillSelect('referenceUniversity');try{session=await idbGet(KEY)||initSession();if(session.started){anchorPerf=performance.now()-(Date.now()-session.startWall);$('storageStatus').textContent='保存データを復旧しました。アプリが停止中だった場合、時計の変更・端末再起動等により計測精度が保証できません。';}else $('storageStatus').textContent='端末内保存が有効です。'}catch(e){$('storageStatus').textContent='警告：端末内保存を利用できません。'+e.message;$('referenceBtn').disabled=true}render();tick();$('referenceBtn').onclick=start;$('goalBtn').onclick=()=>record(anchorPerf!==null?performance.now()-anchorPerf:timeMs());for(const id of ['raceId','university','referenceUniversity'])$(id).addEventListener('change',saveSettings);$('records').onclick=async e=>{const idx=e.target.dataset.edit??e.target.dataset.delete;if(idx===undefined)return;const i=Number(idx);if(e.target.dataset.edit!==undefined){const value=prompt(`${i+1}人目の全体1位との差（秒）`,(session.records[i].elapsedMs/1000).toFixed(3));if(value===null)return;const n=Number(value);if(!Number.isFinite(n)||n<0)return alert('0以上の秒数を入力してください');session.records[i].elapsedMs=Math.round(n*1000)}else{if(!confirm(`${i+1}人目を削除しますか？`))return;session.records.splice(i,1)}session.revision++;await persist();render()};$('undoBtn').onclick=async()=>{if(!session.records.length||!confirm('最後の記録を削除しますか？'))return;session.records.pop();session.revision++;await persist();render()};$('exportBtn').onclick=ownCSV;$('sendBtn').onclick=send;$('newSessionBtn').onclick=()=>resetMeasurement(false);$('newRaceBtn').onclick=()=>resetMeasurement(true);$('tabCollector').onclick=()=>switchTab(false);$('tabBoard').onclick=()=>{switchTab(true);$('boardRaceId').value=session.raceId;if(boardWatchedRace!==session.raceId)watchBoard();};$('connectBtn').onclick=watchBoard;$('boardRaceId').addEventListener('input',()=>resetBoardView('レースIDを変更しました。「集計を更新・監視」を押してください。'));$('boardCsvBtn').onclick=boardCSV;$('rankBody').onchange=e=>{const u=e.target.dataset.correction;if(!u)return;const n=Number(e.target.value);if(!Number.isFinite(n)||Math.abs(n)>60000)return alert('補正値は±60000ms以内にしてください');localStorage.setItem(correctionKey($('boardRaceId').value.trim(),u),String(n));renderBoard()};$('boardRaceId').value=session.raceId;$('copyRaceBtn').onclick=()=>navigator.clipboard?.writeText($('raceId').value).then(()=>$('collectorRaceStatus').textContent='レースIDをコピーしました：'+$('raceId').value).catch(()=>alert('コピーできません。レースIDを手動でコピーしてください。'));if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}
function switchTab(board){$('collector').hidden=board;$('board').hidden=!board;$('tabCollector').classList.toggle('active',!board);$('tabBoard').classList.toggle('active',board)}
setup();
