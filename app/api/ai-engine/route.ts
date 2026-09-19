import {NextResponse} from "next/server";
type Capital={country:string;iso2:string;iso3:string;capital:string;lat:number;lon:number;region:string};
type DecideRequest={step:number;current:Capital;candidates:Capital[];remaining:Capital[];model:string};
export async function GET(){return NextResponse.json({configured:Boolean(process.env.OPENROUTER_API_KEY)})}
export async function POST(req:Request){
 const started=Date.now(); const body=(await req.json()) as DecideRequest; const key=process.env.OPENROUTER_API_KEY;
 if(!key)return NextResponse.json({error:"OPENROUTER_API_KEY is not configured on the server"},{status:400});
 const model=body.model||"openai/gpt-4o-mini";
 const options=body.candidates.map(c=>c.iso2+": "+c.capital+", "+c.country).join("\n");
 const prompt="You are a decision engine inside a controlled TSP benchmark.\n\nCurrent capital: "+body.current.capital+", "+body.current.country+"\nRemaining capitals: "+body.remaining.length+"\n\nChoose exactly ONE next capital from the candidate list. The candidates are the SAME candidates presented to competing decision engines. Use the remaining-capitals context to reason about downstream travel distance.\n\nCANDIDATES:\n"+options+"\n\nReturn ONLY the two-letter ISO2 code of the selected candidate. Do not return confidence, explanation, ranking, or any other text.";
 try{const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key,"HTTP-Referer":process.env.NEXT_PUBLIC_APP_URL||"http://localhost:3000","X-Title":"Worldtour Decision Benchmark"},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0,max_tokens:8})});
  if(!r.ok){const errBody=await r.text();return NextResponse.json({error:"OpenRouter request failed ("+r.status+"): "+errBody.slice(0,300)},{status:502})}
  const data=await r.json(); const text=String(data?.choices?.[0]?.message?.content||"").trim().toUpperCase(); const isoMatch=text.match(/\b[A-Z]{2}\b/); const chosen=body.candidates.find(c=>c.iso2===isoMatch?.[0]);
  if(!chosen)return NextResponse.json({error:"AI returned an invalid candidate selection: "+text.slice(0,80)},{status:502});
  return NextResponse.json({mode:"live",selectedIso2:chosen.iso2,model,rawResponse:text,latencyMs:Date.now()-started});
 }catch(e:any){return NextResponse.json({error:"OpenRouter request errored",message:e?.message||String(e)},{status:502})}
}