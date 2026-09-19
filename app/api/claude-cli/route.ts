import {NextResponse} from "next/server";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync=promisify(execFile);

type Candidate={iso2:string;capital:string;distanceKm:number};
type RequestBody={step:number;current:{iso2:string;capital:string};remainingCount:number;candidates:Candidate[];model?:string};

const CLAUDE_MODELS=["haiku","sonnet","opus"];
const DEFAULT_MODEL="haiku";

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

function extractIso2(text:string,candidates:Candidate[]){
  const cleaned=text.trim().toUpperCase();
  const matches=cleaned.match(/\b[A-Z]{2}\b/g)||[];
  return matches.map(m=>candidates.find(c=>c.iso2===m)).find(Boolean)||null;
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
  const model=body.model||DEFAULT_MODEL;
  const options=body.candidates.map(c=>c.iso2+": "+c.capital+" ("+c.distanceKm+" km)").join(" | ");
  const prompt=[
    "You are one decision step inside a deterministic traveling-salesman benchmark.",
    "Choose exactly ONE candidate from the supplied list.",
    "Objective: minimize the total distance of the eventual complete route, starting from the current capital.",
    "The supplied current-to-candidate distance is the primary decision signal. Never invent or choose an unlisted capital.",
    `Current: ${body.current.capital} (${body.current.iso2}). Remaining after this step: ${body.remainingCount}.`,
    `Candidates: ${options}`,
    "Return ONLY the two-letter ISO2 code of the selected candidate. No explanation, no punctuation, nothing else."
  ].join("\n");
  try{
    const {stdout}=await execFileAsync("claude",["-p","--output-format","json","--disallowedTools","*","--model",model,prompt],{timeout:60000,maxBuffer:10*1024*1024});
    const data=JSON.parse(stdout);
    if(data.is_error)return NextResponse.json({error:"Claude CLI returned an error",message:data.result||"unknown error",model},{status:502});
    const selected=extractIso2(String(data.result||""),body.candidates);
    if(!selected)return NextResponse.json({error:"Claude CLI returned an invalid candidate selection",raw:String(data.result||"").slice(0,300)},{status:502});
    return NextResponse.json({selectedIso2:selected.iso2,model,latencyMs:data.duration_ms??(Date.now()-started),costUsd:data.total_cost_usd});
  }catch(e:any){
    let message=e?.message||String(e);
    if(typeof e?.stdout==="string"&&e.stdout.trim()){
      try{const data=JSON.parse(e.stdout);if(data?.result)message=data.result}catch{}
    }
    return NextResponse.json({error:"Claude CLI request failed",message,model},{status:502});
  }
}
