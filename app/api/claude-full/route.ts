import {NextResponse} from "next/server";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync=promisify(execFile);
const CLAUDE_MODELS=["haiku","sonnet","opus"];
const DEFAULT_MODEL="haiku";

type Capital={iso2:string;capital:string;lat:number;lon:number};
type RequestBody={start:Capital;capitals:Capital[];model?:string};

let availabilityCache:{ok:boolean;at:number}|null=null;
const AVAILABILITY_TTL_MS=5*60*1000;

async function claudeCliAvailable():Promise<boolean>{
  const now=Date.now();
  if(availabilityCache&&now-availabilityCache.at<AVAILABILITY_TTL_MS)return availabilityCache.ok;
  let ok=false;
  try{await execFileAsync("claude",["--version"],{timeout:5000});ok=true}catch{ok=false}
  availabilityCache={ok,at:now};
  return ok;
}

function extractJson(text:string){
  const cleaned=text.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"").trim();
  try{return JSON.parse(cleaned)}catch{}
  const routeMatches=cleaned.match(/\{\s*"route"\s*:\s*\[[^\[\]]*\]\s*\}/g);
  if(routeMatches){
    for(const candidate of [...routeMatches].reverse()){
      try{return JSON.parse(candidate)}catch{}
    }
  }
  const match=cleaned.match(/\{[\s\S]*\}/);
  if(match)try{return JSON.parse(match[0])}catch{}
  return null;
}

export async function GET(){
  const configured=await claudeCliAvailable();
  return NextResponse.json({configured,model:DEFAULT_MODEL,models:CLAUDE_MODELS});
}

export async function POST(req:Request){
  const started=Date.now();
  const body=(await req.json()) as RequestBody;
  const available=await claudeCliAvailable();
  if(!available)return NextResponse.json({error:"Claude CLI is not available on the server (checked `claude --version`)."},{status:503});
  if(!body.start||!Array.isArray(body.capitals)||body.capitals.length!==195){
    return NextResponse.json({error:"Claude Full Problem requires exactly 195 capitals and a selected start city."},{status:400});
  }
  const model=body.model||DEFAULT_MODEL;
  const capitals=body.capitals.map(c=>({i:c.iso2,c:c.capital,a:Number(c.lat.toFixed(4)),o:Number(c.lon.toFixed(4))}));
  const prompt=[
    "Solve the following traveling-salesman routing problem.",
    "Start and end at the selected start capital.",
    "Visit every one of the 195 supplied country capitals exactly once before returning to the start.",
    "Minimize total great-circle travel distance using the supplied latitude/longitude coordinates.",
    "You may choose any heuristic or optimization strategy you can execute within this single response. Do not claim global optimality unless it is actually established.",
    "Return ONLY valid JSON in this exact shape: {\"route\":[\"XX\",\"YY\",...]}",
    "The route must contain the selected start ISO2 as the first and last element and every other supplied ISO2 exactly once.",
    "Selected start: "+body.start.iso2+" ("+body.start.capital+").",
    "Capital dataset (iso2, capital, latitude, longitude):",
    JSON.stringify(capitals)
  ].join("\n");

  try{
    const {stdout}=await execFileAsync("claude",["-p","--output-format","json","--disallowedTools","*","--model",model,prompt],{timeout:180000,maxBuffer:20*1024*1024});
    const data=JSON.parse(stdout);
    if(data.is_error)return NextResponse.json({error:"Claude CLI returned an error",message:data.result||"unknown error",model},{status:502});
    const parsed=extractJson(String(data.result||""));
    const route=parsed?.route;
    if(!Array.isArray(route))return NextResponse.json({error:"Claude Full Problem returned no valid route JSON",raw:String(data.result||"").slice(0,1000),model},{status:502});
    const normalized=route.map((x:any)=>String(x).trim().toUpperCase());
    const expected=new Set(body.capitals.map(c=>c.iso2));
    const bodyRoute=normalized.slice(0,-1);
    const validLength=normalized.length===196;
    const validStart=normalized[0]===body.start.iso2&&normalized[normalized.length-1]===body.start.iso2;
    const unique=new Set(bodyRoute);
    const validSet=unique.size===195&&bodyRoute.every(x=>expected.has(x))&&expected.size===195&&[...expected].every(x=>unique.has(x));
    if(!validLength||!validStart||!validSet){
      return NextResponse.json({error:"Claude Full Problem returned an invalid 195-capital route",details:{length:normalized.length,expectedLength:196,validStart,unique:unique.size,expected:expected.size,validSet},route:normalized,model},{status:422});
    }
    const latencyMs=data.duration_ms??(Date.now()-started);
    return NextResponse.json({
      routeIso2:normalized,
      model,
      latencyMs,
      costUsd:data.total_cost_usd,
      communication:{provider:"Claude Full Problem",model,request:{command:"claude -p --output-format json --disallowedTools * --model "+model,prompt},response:data,latencyMs}
    });
  }catch(e:any){
    let message=e?.message||String(e);
    if(typeof e?.stdout==="string"&&e.stdout.trim()){
      try{const data=JSON.parse(e.stdout);if(data?.result)message=data.result}catch{}
    }
    return NextResponse.json({error:"Claude Full Problem request failed",message,model},{status:502});
  }
}
