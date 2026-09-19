import {NextResponse} from "next/server";
import {CopilotClient} from "@github/copilot-sdk";

type Candidate={iso2:string;capital:string;distanceKm:number};
type RequestBody={step:number;current:{iso2:string;capital:string};remainingCount:number;candidates:Candidate[];model?:string};

function extractJson(text:string){
  const cleaned=text.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
  try{return JSON.parse(cleaned)}catch{}
  const m=cleaned.match(/\{[\s\S]*\}/);
  if(m){try{return JSON.parse(m[0])}catch{}}
  return null;
}

let entitlementCache:{token:string;ok:boolean;at:number}|null=null;
const ENTITLEMENT_TTL_MS=5*60*1000;

async function hasCopilotEntitlement(token:string):Promise<boolean>{
  const now=Date.now();
  if(entitlementCache&&entitlementCache.token===token&&now-entitlementCache.at<ENTITLEMENT_TTL_MS)return entitlementCache.ok;
  let ok=false;
  try{
    const res=await fetch("https://api.github.com/copilot_internal/v2/token",{
      headers:{Authorization:`token ${token}`,"Editor-Version":"vscode/1.85.0","Editor-Plugin-Version":"copilot-chat/0.11.0"}
    });
    ok=res.ok;
  }catch{ok=false}
  entitlementCache={token,ok,at:now};
  return ok;
}

export async function GET(){
  const token=process.env.COPILOT_GITHUB_TOKEN||process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
  const model=process.env.COPILOT_MODEL||"gpt-5.4";
  const models=(process.env.COPILOT_MODELS||model).split(",").map(x=>x.trim()).filter(Boolean);
  const configured=Boolean(token)&&await hasCopilotEntitlement(token!);
  return NextResponse.json({configured,model,models});
}

export async function POST(req:Request){
  const started=Date.now();
  const body=(await req.json()) as RequestBody;
  const token=process.env.COPILOT_GITHUB_TOKEN||process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
  if(!token)return NextResponse.json({error:"GitHub Copilot is not configured. Set COPILOT_GITHUB_TOKEN on the server."},{status:503});
  const model=body.model||process.env.COPILOT_MODEL||"gpt-5.4";
  const client=new CopilotClient({gitHubToken:token,useLoggedInUser:false});
  try{
    await client.start();
    const session=await client.createSession({model});
    const prompt=[
      "You are one decision step inside a deterministic traveling-salesman benchmark.",
      "Choose exactly ONE candidate from the supplied list.",
      "Objective: minimize the total distance of the eventual complete route, starting from the current capital.",
      "The supplied current-to-candidate distance is the primary decision signal. You may reason about the candidate set, but never invent or choose an unlisted capital.",
      "Return ONLY valid JSON in exactly this shape: {\"selectedIso2\":\"XX\"}.",
      JSON.stringify({step:body.step,current:body.current,remainingCount:body.remainingCount,candidates:body.candidates})
    ].join("\n");
    const response=await session.sendAndWait({prompt});
    const parsed=extractJson(response?.data?.content||"");
    const selectedIso2=parsed?.selectedIso2;
    if(typeof selectedIso2!=="string"||!body.candidates.some(c=>c.iso2===selectedIso2)){
      return NextResponse.json({error:"Copilot returned an invalid candidate selection",raw:(response?.data?.content||"").slice(0,500)},{status:502});
    }
    await session.disconnect();
    await client.stop();
    return NextResponse.json({selectedIso2,model,latencyMs:Date.now()-started,communication:{provider:"GitHub Copilot",model,request:{prompt},response:{content:response?.data?.content||""},latencyMs:Date.now()-started}});
  }catch(e:any){
    try{await client.stop()}catch{}
    return NextResponse.json({error:"Copilot request failed",message:e?.message||String(e),model},{status:502});
  }
}
