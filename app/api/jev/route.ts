import {NextResponse} from "next/server";
type Capital={country:string;iso2:string;iso3:string;capital:string;lat:number;lon:number;region:string};
type DecideRequest={step:number;current:Capital;candidates:Capital[];remaining:Capital[]};
function hav(a:Capital,b:Capital){const r=6371.0088,p=Math.PI/180,d1=(b.lat-a.lat)*p,d2=(b.lon-a.lon)*p,x=Math.sin(d1/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(d2/2)**2;return 2*r*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function demoRank(current:Capital,candidates:Capital[],remaining:Capital[]){const scored=candidates.map(c=>{const local=hav(current,c);const rest=remaining.filter(y=>y.iso2!==c.iso2);const future=rest.length?Math.min(...rest.map(y=>hav(c,y))):0;const score=1/(1+local/2500)+0.35/(1+future/1800)+0.12*(c.region===current.region?1:0);return {iso2:c.iso2,score}}).sort((a,b)=>b.score-a.score);const max=scored[0]?.score||1;return scored.map(s=>({iso2:s.iso2,score:s.score/max}))}
export async function GET(){return NextResponse.json({configured:Boolean(process.env.JEV_API_URL&&process.env.JEV_API_KEY)})}
export async function POST(req:Request){
 const started=Date.now(); const body=(await req.json()) as DecideRequest; const url=process.env.JEV_API_URL; const key=process.env.JEV_API_KEY; const model=process.env.JEV_MODEL||"jev-latest";
 if(!url||!key)return NextResponse.json({mode:"demo",ranked:demoRank(body.current,body.candidates,body.remaining),latencyMs:Date.now()-started});
 const criteria:Record<string,string>={}; for(const c of body.candidates)criteria[c.iso2]=c.capital+", "+c.country;
 try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},body:JSON.stringify({state:"Round-the-world capital tour. Current: "+body.current.capital+", "+body.current.country+". Remaining: "+body.remaining.length+". Evaluate ONLY the supplied candidates.",model,questions:{next_capital:{type:"choice",instructions:"Choose exactly one supplied candidate that minimizes expected total remaining travel distance. Use the full remaining-capitals context.",criteria}}})});
  if(!r.ok){const errText=await r.text();return NextResponse.json({error:"JEV provider request failed ("+r.status+"): "+errText.slice(0,300)},{status:502})}
  const data=await r.json(); const answer=data?.answers?.next_capital;
  if(!answer||answer.type!=="choice"||!answer.probabilities)return NextResponse.json({error:"JEV provider returned an unexpected choice response"},{status:502});
  const ranked=body.candidates.map(c=>({iso2:c.iso2,confidence:answer.probabilities[c.iso2]??0})).sort((a,b)=>b.confidence-a.confidence);
  if(!ranked.length)return NextResponse.json({error:"JEV provider returned no candidate scores"},{status:502});
  return NextResponse.json({mode:"live",ranked,model,latencyMs:Date.now()-started});
 }catch(e:any){return NextResponse.json({error:"JEV provider request errored",message:e?.message||String(e)},{status:502})}
}