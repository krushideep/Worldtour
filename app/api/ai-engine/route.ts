import {NextResponse} from "next/server";

type Capital={country:string;iso2:string;iso3:string;capital:string;lat:number;lon:number;region:string};
type DecideRequest={step:number;current:Capital;candidates:Capital[];remaining:Capital[];model:string};
type Ranked={iso2:string;confidence:number};

export async function GET(req:Request){
  const key=req.headers.get("x-openrouter-api-key")||process.env.OPENROUTER_API_KEY;
  return NextResponse.json({configured:Boolean(key)});
}

export async function POST(req:Request){
  const started=Date.now();
  const body=(await req.json()) as DecideRequest;
  const key=req.headers.get("x-openrouter-api-key")||process.env.OPENROUTER_API_KEY;
  if(!key){
    return NextResponse.json({error:"OPENROUTER_API_KEY is not configured — set it in Settings or in .env.local"},{status:400});
  }
  const model=body.model||"openai/gpt-4o-mini";
  const options=body.candidates.map(c=>`${c.iso2}: ${c.capital}, ${c.country}`).join("\n");
  const prompt=`You are planning a round-the-world capital tour. You are currently at ${body.current.capital}, ${body.current.country}. Choose which of these candidate capitals to visit next, aiming to minimize the total remaining travel distance across the whole tour (there are ${body.remaining.length} capitals left to visit in total):
${options}

Respond with ONLY the two-letter ISO code of your chosen city (e.g. "FR"), nothing else.`;

  try{
    const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{
        "content-type":"application/json",
        authorization:`Bearer ${key}`,
        "HTTP-Referer":"http://localhost:3000",
        "X-Title":"Worldtour JEV Benchmark",
      },
      body:JSON.stringify({
        model,
        messages:[{role:"user",content:prompt}],
        temperature:0,
        max_tokens:8,
      }),
    });
    if(!r.ok){
      const errBody=await r.text();
      return NextResponse.json({error:`OpenRouter request failed (${r.status}): ${errBody.slice(0,300)}`},{status:502});
    }
    const data=await r.json();
    const text:string=data?.choices?.[0]?.message?.content||"";
    const found=body.candidates.find(c=>text.toUpperCase().includes(c.iso2));
    const chosen=found||body.candidates[0];
    const ranked:Ranked[]=[
      {iso2:chosen.iso2,confidence:0.95},
      ...body.candidates.filter(c=>c.iso2!==chosen.iso2).map((c,i,arr)=>({iso2:c.iso2,confidence:Math.max(0.1,0.6-0.5*i/Math.max(1,arr.length-1))})),
    ];
    return NextResponse.json({mode:"live",ranked,model,rawResponse:text.trim(),latencyMs:Date.now()-started});
  }catch(e:any){
    return NextResponse.json({error:"OpenRouter request errored",message:e?.message||String(e)},{status:502});
  }
}
