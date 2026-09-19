"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {geoNaturalEarth1,geoPath} from "d3-geo";
import {feature} from "topojson-client";
import world from "world-atlas/countries-110m.json";

type Capital={country:string;iso2:string;iso3:string;capital:string;lat:number;lon:number;region:string};
type Decision={step:number;from:Capital;selected:Capital;candidates:{city:Capital;score:number;confidence?:number}[];distanceKm:number;confidence?:number;oracleIso2?:string;regretKm?:number};
type Result={algorithm:string;route:Capital[];distanceKm:number;runtimeMs:number;decisions:Decision[]};
type LogEntry={step:number;from:string;to:string;km:number;pct?:number;candidates?:string}|{note:string};
type Settings={};
const EMPTY_SETTINGS:Settings={};
const SETTINGS_KEY="worldtour_settings";
function jevHeaders(){return {"content-type":"application/json"}}
function aiHeaders(){return {"content-type":"application/json"}}

const HOME:Capital={country:"India",iso2:"IN",iso3:"IND",capital:"Bengaluru",lat:12.9716,lon:77.5946,region:"Asia"};
const ISO195=new Set("AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW PS".split(" "));
const conventions:Record<string,string>={BO:"Sucre",LK:"Sri Jayawardenepura Kotte",ZA:"Pretoria",TZ:"Dodoma",PS:"Ramallah",NR:"Yaren"};
const manual:Record<string,Capital>={SS:{country:"South Sudan",iso2:"SS",iso3:"SSD",capital:"Juba",lat:4.8594,lon:31.5713,region:"Other"}};
function hav(a:Capital,b:Capital){const r=6371.0088,p=Math.PI/180,d1=(b.lat-a.lat)*p,d2=(b.lon-a.lon)*p,x=Math.sin(d1/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(d2/2)**2;return 2*r*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function dist(r:Capital[]){let d=0;for(let i=0;i<r.length-1;i++)d+=hav(r[i],r[i+1]);return d}
function rng(seed:number){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function randomRoute(c:Capital[],start:Capital=HOME,seed=20260919){const a=[...c],r=rng(seed);for(let i=a.length-1;i;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return[start,...a,start]}
function nearest(c:Capital[],start:Capital=HOME){const a=[...c],out=[start];let cur=start;while(a.length){let bi=0,bd=Infinity;for(let i=0;i<a.length;i++){const d=hav(cur,a[i]);if(d<bd){bd=d;bi=i}}cur=a.splice(bi,1)[0];out.push(cur)}out.push(start);return out}
function twoOpt(route:Capital[]){const o=[...route];let improved=true,loops=0;while(improved&&loops++<1000){improved=false;for(let i=1;i<o.length-3;i++)for(let j=i+1;j<o.length-1;j++){const old=hav(o[i-1],o[i])+hav(o[j],o[j+1]),neu=hav(o[i-1],o[j])+hav(o[i],o[j+1]);if(neu<old-1e-7){o.splice(i,j-i+1,...o.slice(i,j+1).reverse());improved=true}}}return o}
function oracleChoice(cur:Capital,cs:Capital[],rem:Capital[]){const scored=cs.map(c=>{const rest=rem.filter(x=>x.iso2!==c.iso2);const next=rest.length?Math.min(...rest.map(x=>hav(c,x))):0;return{iso2:c.iso2,cost:hav(cur,c)+next}}).sort((a,b)=>a.cost-b.cost);return scored[0]||null}
function candidates(cur:Capital,rem:Capital[],seed:number){const near=[...rem].sort((x,y)=>hav(cur,x)-hav(cur,y));const p=near.slice(0,4);const far=[...rem].sort((x,y)=>hav(cur,y)-hav(cur,x)).filter(x=>!p.includes(x));p.push(...far.slice(0,2));const pick=rng(seed+97);while(p.length<8&&p.length<rem.length){const x=rem[Math.floor(pick()*rem.length)];if(!p.includes(x))p.push(x)}return p.slice(0,8)}
async function jevDecide(step:number,current:Capital,cs:Capital[],rem:Capital[],settings:Settings):Promise<{ranked:{city:Capital;confidence:number}[];mode:"demo"|"live"}>{
  const res=await fetch("/api/jev",{method:"POST",headers:jevHeaders(),body:JSON.stringify({step,current,candidates:cs,remaining:rem})});
  const data=await res.json();
  if(!res.ok||data.error)throw new Error(data.error||"JEV request failed ("+res.status+")");
  const byIso=new Map(cs.map(c=>[c.iso2,c]));
  const ranked=(data.ranked as {iso2:string;confidence:number}[]).map(r=>({city:byIso.get(r.iso2)!,confidence:r.confidence})).filter(x=>x.city);
  if(!ranked.length)throw new Error("JEV response did not match any candidate");
  return{ranked,mode:data.mode as "demo"|"live"};
}
async function jev(c:Capital[],start:Capital=HOME,settings:Settings=EMPTY_SETTINGS,onMode?:(m:"demo"|"live")=>void,onStep?:(d:Decision,routeSoFar:Capital[])=>void){let cur=start,rem=[...c],route=[start],ds:Decision[]=[];const maxSteps=c.length;while(rem.length){if(ds.length>=maxSteps)throw new Error("JEV loop exceeded expected step count ("+maxSteps+") — aborting to avoid runaway API calls");const cs=candidates(cur,rem,route.length*19);const{ranked,mode}=await jevDecide(route.length,cur,cs,rem,settings);onMode?.(mode);const pick=ranked[0].city;const oracle=oracleChoice(cur,cs,rem);const chosenCost=oracle?oracle.cost:0;const selectedCost=hav(cur,pick)+(rem.length>1?Math.min(...rem.filter(x=>x.iso2!==pick.iso2).map(x=>hav(pick,x))):0);const d={step:route.length,from:cur,selected:pick,candidates:ranked.map(x=>({city:x.city,score:x.confidence,confidence:x.confidence})),distanceKm:hav(cur,pick),confidence:ranked[0].confidence,oracleIso2:oracle?.iso2,regretKm:Math.max(0,selectedCost-chosenCost)};ds.push(d);route.push(pick);onStep?.(d,[...route]);rem=rem.filter(x=>x!==pick);cur=pick}route.push(start);return{route,decisions:ds}}
async function aiDecide(step:number,current:Capital,cs:Capital[],rem:Capital[],model:string,settings:Settings):Promise<{selected:Capital}>{
  const res=await fetch("/api/ai-engine",{method:"POST",headers:aiHeaders(),body:JSON.stringify({step,current,candidates:cs,remaining:rem,model})});
  const data=await res.json();
  if(!res.ok||data.error)throw new Error(data.error||"AI engine request failed ("+res.status+")");
  const selected=cs.find(c=>c.iso2===data.selectedIso2);
  if(!selected)throw new Error("AI engine returned an invalid candidate selection");
  return{selected};
}
async function aiEngine(c:Capital[],start:Capital=HOME,model:string,settings:Settings=EMPTY_SETTINGS,onStep?:(d:Decision,routeSoFar:Capital[])=>void){let cur=start,rem=[...c],route=[start],ds:Decision[]=[];const maxSteps=c.length;while(rem.length){if(ds.length>=maxSteps)throw new Error("AI Engine loop exceeded expected step count ("+maxSteps+") — aborting to avoid runaway API calls");const cs=candidates(cur,rem,route.length*19);const{selected}=await aiDecide(route.length,cur,cs,rem,model,settings);const pick=selected;const d={step:route.length,from:cur,selected:pick,candidates:cs.map(city=>({city,score:city.iso2===pick.iso2?1:0})),distanceKm:hav(cur,pick)};ds.push(d);route.push(pick);onStep?.(d,[...route]);rem=rem.filter(x=>x!==pick);cur=pick}route.push(start);return{route,decisions:ds}}
async function load():Promise<Capital[]>{const r=await fetch("https://raw.githubusercontent.com/Stefie/geojson-world/46cbac88be743326b247baee180928683d0afe9f/capitals.geojson");if(!r.ok)throw Error("Capital dataset unavailable");const j=await r.json(),m=new Map<string,Capital>();for(const f of j.features||[]){const p=f.properties||{},id=p.iso2||f.id,name=p.city||conventions[id];if(!ISO195.has(id)||!name||!f.geometry?.coordinates)continue;m.set(id,{country:p.country,iso2:id,iso3:p.iso3,capital:conventions[id]||name,lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],region:"Other"})}for(const id in manual)if(!m.has(id))m.set(id,manual[id]);const ov:Record<string,[number,number]>={LK:[6.9271,79.8612],BO:[-19.0196,-65.2619],ZA:[-25.7479,28.2293],TZ:[-6.163,35.7516],PS:[31.9038,35.2034],IN:[28.6139,77.209]};for(const k in ov)if(m.has(k)){m.get(k)!.lat=ov[k][0];m.get(k)!.lon=ov[k][1]}const out=[...m.values()].sort((a,b)=>a.country.localeCompare(b.country));if(out.length!==195)throw Error("Expected 195 capitals, found "+out.length);return out}

const AI_MODELS=["openai/gpt-4o-mini","google/gemini-2.0-flash-001","anthropic/claude-3.5-haiku","meta-llama/llama-3.1-8b-instruct","qwen/qwen-2.5-72b-instruct"];
const BASE_ALGOS=["Random","Nearest Neighbor","NN + 2-opt","JEV","JEV + 2-opt"];
function pad(n:number){return String(n).padStart(3,"0")}
function decisionLine(d:Decision){return `${pad(d.step)}  ${d.from.capital} → ${d.selected.capital}   ${d.distanceKm.toFixed(0)} km   ${Math.round(d.confidence*100)}%`}
function DecisionMini({d}:{d?:Decision}){
  if(!d)return <span className="empty">—</span>;
  return <div className="benchDecision"><span>{d.from.capital} → {d.selected.capital}</span><i>{Math.round(d.confidence*100)}%</i></div>;
}
function BenchCard({algorithm,route,decisions,distanceKm,runtimeMs,live}:{algorithm:string;route:Capital[];decisions:Decision[];distanceKm:number;runtimeMs:number;live?:boolean}){
  return <div className={live?"benchCard live":"benchCard"}>
    <div className="benchCardHead"><b>{algorithm}</b><span className={live?"runTag":"doneTag"}>{live?"RUNNING":"DONE"}</span><strong>{distanceKm?distanceKm.toLocaleString(undefined,{maximumFractionDigits:0})+" km":"—"}</strong><small>{live?decisions.length+"/195":(runtimeMs/1000).toFixed(1)+" s"}</small></div>
    <div className="benchCardBody">
      <div className="benchMini"><b>LIVE OUTPUT</b><div className="benchLog">{decisions.length?decisions.slice(-30).map((d,i)=><div key={i}>{decisionLine(d)}</div>):<span className="empty">—</span>}</div></div>
      <div className="benchMini"><b>DECISION</b><DecisionMini d={decisions[decisions.length-1]}/></div>
      <div className="benchMini"><b>ROUTE</b><div className="benchRouteList">{route.slice(-30).map((c,i)=><div key={i}>{c.capital}</div>)}</div></div>
    </div>
  </div>;
}
export default function Home(){const[cities,setCities]=useState<Capital[]>([]),[err,setErr]=useState(""),[result,setResult]=useState<Result|null>(null),[bench,setBench]=useState<Result[]>([]),[step,setStep]=useState(0),[speed,setSpeed]=useState(1),[algorithm,setAlgorithm]=useState("JEV + 2-opt"),[region,setRegion]=useState("All"),[showCandidates,setShowCandidates]=useState(true),[running,setRunning]=useState(false),[providerMode,setProviderMode]=useState<"demo"|"live">("demo"),[aiConfigured,setAiConfigured]=useState(false),[aiModel,setAiModel]=useState(AI_MODELS[0]),[benchModels,setBenchModels]=useState<string[]>([AI_MODELS[0]]),[benchAlgos,setBenchAlgos]=useState<string[]>([...BASE_ALGOS]),[benchLive,setBenchLive]=useState<{algorithm:string;route:Capital[];decisions:Decision[]}|null>(null),[textMode,setTextMode]=useState(false),[log,setLog]=useState<LogEntry[]>([]),[startIso,setStartIso]=useState("HOME"),[settings,setSettings]=useState<Settings>(EMPTY_SETTINGS),[settingsDraft,setSettingsDraft]=useState<Settings>(EMPTY_SETTINGS),[settingsSaved,setSettingsSaved]=useState(false),busyRef=useRef(false),logEndRef=useRef<HTMLDivElement>(null),routeEndRef=useRef<HTMLDivElement>(null);
function checkProviders(s:Settings){fetch("/api/jev",{headers:jevHeaders()}).then(r=>r.json()).then(d=>setProviderMode(d.configured?"live":"demo")).catch(()=>{});fetch("/api/ai-engine",{headers:aiHeaders()}).then(r=>r.json()).then(d=>setAiConfigured(!!d.configured)).catch(()=>{})}
function saveSettings(next:Settings){setSettings(next);try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(next))}catch{}checkProviders(next);setSettingsSaved(true);setTimeout(()=>setSettingsSaved(false),2000)}
useEffect(()=>{let s=EMPTY_SETTINGS;try{const raw=localStorage.getItem(SETTINGS_KEY);if(raw)s={...EMPTY_SETTINGS,...JSON.parse(raw)}}catch{}setSettings(s);setSettingsDraft(s);load().then(setCities).catch(e=>setErr(e.message));checkProviders(s)},[]);
useEffect(()=>{if(textMode)logEndRef.current?.scrollIntoView({block:"end"})},[log,textMode]);
useEffect(()=>{if(running)routeEndRef.current?.scrollIntoView({block:"end"})},[step,running]);
function pushLog(entry:LogEntry){setLog(prev=>prev.length>600?[...prev.slice(-600),entry]:[...prev,entry])}
const startCity=startIso==="HOME"?HOME:cities.find(c=>c.iso2===startIso)||HOME,tourCities=startIso==="HOME"?cities:cities.filter(c=>c.iso2!==startIso),startOptions=useMemo(()=>[...cities].sort((a,b)=>a.capital.localeCompare(b.capital)),[cities]);
const features=useMemo(()=>feature(world as any,(world as any).objects.countries) as any,[]),projection=useMemo(()=>geoNaturalEarth1().fitSize([1000,510],features),[features]),path=useMemo(()=>geoPath(projection),[projection]);const route=result?.route||[],visible=running?route.slice(0,Math.max(1,step+1)):route,current=visible[visible.length-1]||startCity,decision=result?.decisions.find(x=>x.step===step),filtered=cities.filter(x=>region==="All"||x.region===region),line=visible.map(x=>projection([x.lon,x.lat])?.join(",")).filter(Boolean).join(" ");
async function run(){if(!cities.length||busyRef.current)return;busyRef.current=true;setRunning(true);setLog([]);const t=performance.now();
  try{
    const isJevLike=algorithm==="JEV"||algorithm==="JEV + 2-opt",isAiLike=algorithm==="AI Engine"||algorithm==="AI Engine + 2-opt";
    if(isJevLike||isAiLike){
      setResult({algorithm,route:[startCity],distanceKm:0,runtimeMs:0,decisions:[]});setStep(0);
      let cumulative=0;
      const onStep=(d:Decision,routeSoFar:Capital[])=>{
        cumulative+=d.distanceKm;
        setStep(d.step);
        setResult(prev=>prev?{...prev,route:routeSoFar,distanceKm:cumulative,runtimeMs:performance.now()-t,decisions:[...prev.decisions,d]}:prev);
        pushLog({step:d.step,from:d.from.capital,to:d.selected.capital,km:d.distanceKm,pct:d.confidence!=null?Math.round(d.confidence*100):undefined,candidates:d.candidates.map(x=>x.city.capital).join(", ")});
      };
      const j=isAiLike?await aiEngine(tourCities,startCity,aiModel,settings,onStep):await jev(tourCities,startCity,settings,setProviderMode,onStep);
      const wantsTwoOpt=algorithm.endsWith("2-opt");
      const x=wantsTwoOpt?twoOpt(j.route):j.route;
      if(wantsTwoOpt)pushLog({note:`running 2-opt refinement on the ${dist(j.route).toFixed(0)} km greedy route`});
      const finalDist=dist(x);
      setResult({algorithm,route:x,distanceKm:finalDist,runtimeMs:performance.now()-t,decisions:j.decisions});
      setStep(x.length-1);
      if(wantsTwoOpt)pushLog({note:`2-opt refined: ${finalDist.toFixed(0)} km (was ${dist(j.route).toFixed(0)} km)`});
    }else{
      const x=algorithm==="Random"?randomRoute(tourCities,startCity):algorithm==="Nearest Neighbor"?nearest(tourCities,startCity):twoOpt(nearest(tourCities,startCity));
      setResult({algorithm,route:x,distanceKm:dist(x),runtimeMs:performance.now()-t,decisions:[]});setStep(0);
      for(let i=1;i<x.length;i++){
        await new Promise(res=>setTimeout(res,Math.max(8,180/speed)));
        setStep(i);
        setResult(prev=>prev?{...prev,runtimeMs:performance.now()-t}:prev);
        pushLog({step:i,from:x[i-1].capital,to:x[i].capital,km:hav(x[i-1],x[i])});
      }
    }
  }catch(e:any){setErr(e?.message||"Request failed");setRunning(false);busyRef.current=false;return}
  setRunning(false);busyRef.current=false;
}
async function benchmark(){if(!cities.length||busyRef.current)return;busyRef.current=true;setRunning(true);setBench([]);try{
  const t=async(fn:()=>Promise<Result>)=>{const s=performance.now(),r=await fn();r.runtimeMs=performance.now()-s;return r};
  const push=(r:Result)=>setBench(prev=>[...prev,r]);

  if(benchAlgos.includes("Random")){
    push(await t(async()=>{const x=randomRoute(tourCities,startCity);return{algorithm:"Random",route:x,distanceKm:dist(x),runtimeMs:0,decisions:[]}}));
  }

  if(benchAlgos.includes("Nearest Neighbor")||benchAlgos.includes("NN + 2-opt")){
    if(benchAlgos.includes("Nearest Neighbor"))push(await t(async()=>{const n=nearest(tourCities,startCity);return{algorithm:"Nearest Neighbor",route:n,distanceKm:dist(n),runtimeMs:0,decisions:[]}}));
    if(benchAlgos.includes("NN + 2-opt"))push(await t(async()=>{const n=nearest(tourCities,startCity);const x=twoOpt(n);return{algorithm:"NN + 2-opt",route:x,distanceKm:dist(x),runtimeMs:0,decisions:[]}}));
  }

  if(benchAlgos.includes("JEV")||benchAlgos.includes("JEV + 2-opt")){
    setBenchLive({algorithm:"JEV",route:[startCity],decisions:[]});
    const onStep=(d:Decision,routeSoFar:Capital[])=>setBenchLive(prev=>prev?{...prev,route:routeSoFar,decisions:[...prev.decisions,d]}:prev);
    const j=await jev(tourCities,startCity,settings,setProviderMode,onStep);
    setBenchLive(null);
    if(benchAlgos.includes("JEV"))push(await t(async()=>({algorithm:"JEV",route:j.route,distanceKm:dist(j.route),runtimeMs:0,decisions:j.decisions})));
    if(benchAlgos.includes("JEV + 2-opt"))push(await t(async()=>{const x=twoOpt(j.route);return{algorithm:"JEV + 2-opt",route:x,distanceKm:dist(x),runtimeMs:0,decisions:j.decisions}}));
  }

  if(aiConfigured){
    for(const model of benchModels){
      setBenchLive({algorithm:"AI: "+model,route:[startCity],decisions:[]});
      const onStep=(d:Decision,routeSoFar:Capital[])=>setBenchLive(prev=>prev?{...prev,route:routeSoFar,decisions:[...prev.decisions,d]}:prev);
      const ai=await t(async()=>{const r=await aiEngine(tourCities,startCity,model,settings,onStep);return{algorithm:"AI: "+model,route:r.route,distanceKm:dist(r.route),runtimeMs:0,decisions:r.decisions}});
      setBenchLive(null);
      push(ai);
      push(await t(async()=>{const x=twoOpt(ai.route);return{algorithm:"AI: "+model+" + 2-opt",route:x,distanceKm:dist(x),runtimeMs:0,decisions:ai.decisions}}));
    }
  }
}catch(e:any){setErr(e?.message||"Request failed");setBenchLive(null)}setRunning(false);busyRef.current=false}
function percentile(values:number[],p:number){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);const i=(a.length-1)*p;const lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo)}
function Scorecard({rows}:{rows:Result[]}){const grouped=rows.map(r=>{const base=r.algorithm.replace(/ \+ 2-opt$/,"");const raw=rows.find(x=>x.algorithm===base);const opt=r.algorithm.endsWith("2-opt");const decisions=r.decisions;const regret=decisions.filter(d=>d.regretKm!=null).map(d=>d.regretKm!);const agreement=decisions.length?decisions.filter(d=>d.oracleIso2===d.selected.iso2).length/decisions.length:null;return{r,base,rawDistance:raw?.distanceKm??(opt?null:r.distanceKm),improvement:opt&&raw?((raw.distanceKm-r.distanceKm)/raw.distanceKm)*100:null,agreement,regret:regret.length?regret.reduce((a,b)=>a+b,0)/regret.length:null,p50:null,p95:null}});return <section className="benchmark panel"><div className="panelTitle">BENCHMARK SCORECARD <span>DECISION QUALITY + ROUTE QUALITY</span></div><div className="timingTable"><div className="timingRow timingHead"><span>Method</span><span>Final km</span><span>Raw km</span><span>2-opt gain</span><span>Oracle %</span><span>Avg regret</span><span>Time</span></div>{grouped.map(x=><div className="timingRow" key={x.r.algorithm}><span>{x.r.algorithm}</span><span>{x.r.distanceKm.toLocaleString(undefined,{maximumFractionDigits:0})}</span><span>{x.rawDistance?.toLocaleString(undefined,{maximumFractionDigits:0})??"—"}</span><span>{x.improvement!=null?x.improvement.toFixed(1)+"%":"—"}</span><span>{x.agreement!=null?(x.agreement*100).toFixed(1)+"%":"—"}</span><span>{x.regret!=null?x.regret.toFixed(0)+" km":"—"}</span><span>{(x.r.runtimeMs/1000).toFixed(2)} s</span></div>)}</div><div className="scoreLegend">Oracle agreement = fraction of decisions matching the deterministic one-step oracle. Regret = selected downstream cost minus oracle candidate cost. These are benchmark diagnostics, not claims of global optimality.</div></section>}
if(err)return <main className="shell"><div className="error">DATASET ERROR<span>{err}</span></div></main>;
return <main className="shell"><header className="topbar"><div><h1>WORLD<span>TOUR</span></h1></div><div className="status"><span className={providerMode==="live"?"dot live":"dot"}/><div>{providerMode==="live"?"JEV LIVE":"JEV DEMO"}</div><small>{providerMode==="live"?"System One connected":"Deterministic provider"}</small></div></header>
<section className="hero"><div><strong>{tourCities.length}</strong><span>CAPITALS</span></div><div><strong>{tourCities.length+1}</strong><span>LEGS</span></div><div><strong>{result?result.distanceKm.toLocaleString(undefined,{maximumFractionDigits:0})+" km":"—"}</strong><span>ROUTE DISTANCE</span></div><div><strong>{result?.decisions.length||0}</strong><span>JEV DECISIONS</span></div><div><strong>{result?(result.runtimeMs/1000).toFixed(1)+" s":"—"}</strong><span>TIME</span></div></section>
<section className="controls"><button onClick={run} disabled={!cities.length||running}>{running?"RUNNING":"RUN"}</button><button className="ghost" onClick={benchmark} disabled={!cities.length||running}>BENCHMARK ALL</button><label>START<select value={startIso} onChange={e=>setStartIso(e.target.value)} disabled={running}><option value="HOME">Bengaluru (home base)</option>{startOptions.map(c=><option key={c.iso2} value={c.iso2}>{c.capital} — {c.country}</option>)}</select></label><details className="modelPicker"><summary>SETTINGS</summary><div className="modelPickerBody settingsBody"><b className="pickerGroup">PROVIDER CONFIGURATION</b><div className="aiHint">JEV_API_URL, JEV_API_KEY, JEV_MODEL and OPENROUTER_API_KEY are server-side environment variables. No provider secrets are stored in this browser.</div></div></details><details className="modelPicker"><summary>SELECT ({benchAlgos.length+benchModels.length})</summary><div className="modelPickerBody"><b className="pickerGroup">ALGORITHMS</b>{BASE_ALGOS.map(a=><label key={a}><input type="checkbox" checked={benchAlgos.includes(a)} onChange={e=>setBenchAlgos(prev=>e.target.checked?[...prev,a]:prev.filter(x=>x!==a))}/> {a}</label>)}<b className="pickerGroup">AI MODELS{!aiConfigured&&" (no key)"}</b>{AI_MODELS.map(m=><label key={m}><input type="checkbox" checked={benchModels.includes(m)} disabled={!aiConfigured} onChange={e=>setBenchModels(prev=>e.target.checked?[...prev,m]:prev.filter(x=>x!==m))}/> {m}</label>)}</div></details><label>ALGORITHM<select value={algorithm} onChange={e=>setAlgorithm(e.target.value)}><option>JEV + 2-opt</option><option>JEV</option><option>NN + 2-opt</option><option>Nearest Neighbor</option><option>Random</option><option disabled={!aiConfigured}>AI Engine + 2-opt</option><option disabled={!aiConfigured}>AI Engine</option></select></label>{!aiConfigured&&<small className="aiHint">Set OPENROUTER_API_KEY in .env.local to enable AI Engine</small>}{(algorithm==="AI Engine"||algorithm==="AI Engine + 2-opt")&&<label>MODEL<select value={aiModel} onChange={e=>setAiModel(e.target.value)}>{AI_MODELS.map(m=><option key={m} value={m}>{m}</option>)}</select></label>}<label>SPEED<select value={speed} onChange={e=>setSpeed(+e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label>MODE<div className="viewToggle"><button type="button" className={!textMode?"active":""} onClick={()=>setTextMode(false)}>MAP</button><button type="button" className={textMode?"active":""} onClick={()=>setTextMode(true)}>TEXT</button></div></label></section>
<section className="grid3">
{textMode?<div className="console panel"><div className="panelTitle">LIVE OUTPUT <span>{algorithm}{running?" · running":result?" · done":""}</span></div><div className="consoleBody">{log.length?<div className="logTable"><div className="logRow logHead"><span>Step</span><span>From</span><span>To</span><span>Distance</span><span>Conf</span><span>Candidates</span></div>{log.map((l,i)=>"note" in l?<div className="logNote" key={i}>{l.note}</div>:<div className="logRow" key={i}><span>{String(l.step).padStart(3,"0")}</span><b>{l.from}</b><b>{l.to}</b><span>{l.km.toFixed(0)} km</span><span>{l.pct!=null?l.pct+"%":"—"}</span><i>{l.candidates||"—"}</i></div>)}</div>:<div className="empty">Run an algorithm to watch its decisions stream in here, live, as they happen.</div>}<div ref={logEndRef}/></div></div>:
<div className="mapCard"><div className="mapHead"><div><b>WORLD ROUTE</b><span>START / END · {startCity.capital.toUpperCase()}, {startCity.country.toUpperCase()}</span></div><div className="filters"><select value={region} onChange={e=>setRegion(e.target.value)}><option>All</option></select><label><input type="checkbox" checked={showCandidates} onChange={e=>setShowCandidates(e.target.checked)}/> candidates</label></div></div><svg viewBox="0 0 1000 510" className="map"><g className="land">{features.features.map((f:any,i:number)=><path key={i} d={path(f)||""}/>)}</g>{line&&<polyline points={line} className="route"/>}{filtered.map(c=>{const p=projection([c.lon,c.lat]);if(!p)return null;const active=c.iso2===current.iso2,cand=showCandidates&&(decision?.candidates.some(x=>x.city.iso2===c.iso2)||false);return <g key={c.iso2} className={active?"capital active":cand?"capital candidate":"capital"}><circle cx={p[0]} cy={p[1]} r={active?5:cand?4:2.2}/><title>{c.capital+", "+c.country}</title></g>})}</svg></div>}
<div className="panel"><div className="panelTitle">DECISION TRACE <span>{decision?"#"+decision.step:"—"}</span></div><div className="panelBody">{decision?<><div className="decisionCurrent"><small>CURRENT</small><b>{decision.from.capital}</b><span>{decision.from.country}</span></div><div className="decisionPick"><small>SELECTED</small><b>{decision.selected.capital}</b><span>{decision.selected.country+" · "+decision.distanceKm.toFixed(0)+" km"}</span><em>{decision.confidence!=null?Math.round(decision.confidence*100)+"%":"—"}</em></div><div className="candidates">{decision.candidates.map((x,i)=><div key={x.city.iso2}><span>{String(i+1).padStart(2,"0")}</span><b>{x.city.capital}</b><i>{x.confidence!=null?Math.round(x.confidence*100)+"%":"—"}</i><meter min="0" max="1" value={x.confidence??0}/></div>)}</div></>:<div className="empty">Run to inspect candidate decisions.</div>}</div></div>
<div className="panel routePanel"><div className="panelTitle">ROUTE <span>{visible.length?Math.min(step,tourCities.length+1)+"/"+(tourCities.length+1):"READY"}</span></div><div className="routeList">{visible.map((c,i)=><div key={i} className={i===visible.length-1?"currentRow":""}><span>{String(i).padStart(3,"0")}</span><b>{c.capital}</b><small>{c.country}</small>{i<visible.length-1&&<i>{hav(c,visible[i+1]).toFixed(0)} km</i>}</div>)}<div ref={routeEndRef}/></div></div>
</section>
<section className="benchmark panel"><div className="panelTitle">BENCHMARK <span>SEED 20260919 · SAME DATASET</span></div>{bench.length||benchLive?<div className="benchList">{bench.map(x=><BenchCard key={x.algorithm} algorithm={x.algorithm} route={x.route} decisions={x.decisions} distanceKm={x.distanceKm} runtimeMs={x.runtimeMs}/>)}{benchLive&&<BenchCard key="live" algorithm={benchLive.algorithm} route={benchLive.route} decisions={benchLive.decisions} distanceKm={dist(benchLive.route)} runtimeMs={0} live/>}</div>:<div className="empty">Run the benchmark to compare all methods.</div>}</section>
{bench.length>0&&<Scorecard rows={bench}/>} {bench.length>0&&<section className="benchmark panel"><div className="panelTitle">TIMING REPORT <span>fastest first</span></div><div className="timingTable"><div className="timingRow timingHead"><span>Algorithm</span><span>Total Time</span><span>Legs</span><span>ms / leg</span><span>Decisions</span><span>ms / decision</span></div>{[...bench].sort((a,b)=>a.runtimeMs-b.runtimeMs).map((x,i)=>{const legs=Math.max(1,x.route.length-1);return<div className={i===0?"timingRow fastest":"timingRow"} key={x.algorithm}><span>{x.algorithm}</span><span>{(x.runtimeMs/1000).toFixed(2)+" s"}</span><span>{legs}</span><span>{(x.runtimeMs/legs).toFixed(1)}</span><span>{x.decisions.length||"—"}</span><span>{x.decisions.length?(x.runtimeMs/x.decisions.length).toFixed(1):"—"}</span></div>})}</div></section>}
<footer><span>✓ {cities.length||"—"} / 195 capitals loaded</span><span>Great-circle · R = 6371.0088 km</span><span>Heuristic benchmark — not a proof of global optimum</span></footer></main>}
