import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL") || "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const secret = Deno.env.get("FOOTBALL_API_ENCRYPTION_KEY") || "";
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS", "Content-Type":"application/json; charset=utf-8" };
const reply = (status:number,data:Record<string,unknown>) => new Response(JSON.stringify(data),{status,headers:cors});
function b64bytes(s:string){const b=atob(s);return Uint8Array.from(b,c=>c.charCodeAt(0));}
async function decrypt(cipher:string,iv:string){if(secret.length<32)throw Error("Football API encryption secret is not configured.");const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));const k=await crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["decrypt"]);return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:b64bytes(iv)},k,b64bytes(cipher)));}
function validDate(value:unknown){const s=String(value||"");return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:new Date().toISOString().slice(0,10);}
function normalizeOpenLiga(rows:any[]){return rows.map(x=>{const h=x.Team1||{},a=x.Team2||{},r=x.MatchResults||[],last=r[r.length-1]||{},date=x.MatchDate?new Date(x.MatchDate):null,finished=x.MatchIsFinished===true||String(x.MatchIsFinished).toLowerCase()==="true",now=new Date(),live=!finished&&date&&!Number.isNaN(date.getTime())&&date<=now&&now.getTime()-date.getTime()<3*60*60*1000;return {league:x.LeagueName||x.League?.LeagueName||"Football",league_code:x.LeagueShortcut||x.League?.LeagueShortcut||"",home:{name:h.TeamName||"Home"},away:{name:a.TeamName||"Away"},home_score:last.PointsTeam1??null,away_score:last.PointsTeam2??null,status:finished?"FT":live?"LIVE":"Scheduled",kickoff:x.MatchDate,match_id:x.MatchID};});}
function classify(matches:any[],view:string,date:string){const now=new Date();return matches.filter(m=>{const d=m.kickoff?new Date(m.kickoff):null,valid=d&&!Number.isNaN(d.getTime()),finished=m.status==="FT",live=m.status==="LIVE";if(view==="live")return live;if(view==="results")return finished&&(!valid||m.kickoff.slice(0,10)===date);if(view==="upcoming")return !finished&&!live&&valid&&d>now;if(view==="today")return valid&&m.kickoff.slice(0,10)===date;return false;});}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return reply(405,{ok:false,error:"POST required"});
 try{
  const body=await req.json().catch(()=>({})),view=["live","today","upcoming","results"].includes(body.view)?body.view:"live",date=validDate(body.date),db=createClient(url,key);
  const {data:settings,error:se}=await db.from("football_automation_settings").select("selected_api_config_id,public_livescore_enabled,public_livescore_cache_seconds,cache_seconds").eq("id",true).single();if(se)throw se;
  if(settings?.public_livescore_enabled===false)return reply(200,{ok:true,matches:[],view,message:"LiveScore is disabled by administrator."});if(!settings?.selected_api_config_id)return reply(200,{ok:true,matches:[],view,message:"No primary football provider configured."});
  const cacheKey=`livescore:${view}:${date}`,now=new Date();const {data:cached}=await db.from("football_public_cache").select("payload,expires_at,provider_name").eq("cache_key",cacheKey).maybeSingle();if(cached&&new Date(cached.expires_at)>now)return reply(200,{...cached.payload,provider:cached.provider_name,cached:true});
  const {data:provider,error:pe}=await db.from("football_api_configs").select("id,provider_name,provider_code,api_base_url,auth_header_name,auth_prefix,api_key_ciphertext,api_key_iv,has_api_key,is_enabled").eq("id",settings.selected_api_config_id).single();if(pe)throw pe;if(!provider?.is_enabled)throw Error("Primary football provider is disabled.");
  if(provider.provider_code!=="openligadb")throw Error(`The selected provider (${provider.provider_name}) does not have a public match-data adapter yet. OpenLigaDB is currently supported.`);
  const base=new URL(provider.api_base_url);if(base.protocol!=="https:")throw Error("Football provider URL must use HTTPS.");const target=new URL("getmatchdata",base.toString().replace(/\/$/,"")+"/");target.searchParams.set("matchDate",date);
  const headers=new Headers();if(provider.has_api_key&&provider.api_key_ciphertext&&provider.api_key_iv&&provider.auth_header_name){const clear=await decrypt(provider.api_key_ciphertext,provider.api_key_iv);headers.set(provider.auth_header_name,provider.auth_prefix?provider.auth_prefix+" "+clear:clear);}
  const res=await fetch(target,{headers,signal:AbortSignal.timeout(12000),redirect:"error"});if(!res.ok)throw Error("Provider returned HTTP "+res.status);const raw=await res.json();const rows=Array.isArray(raw)?raw:Array.isArray(raw?.data)?raw.data:[];let matches=normalizeOpenLiga(rows);
  // OpenLigaDB's date endpoint returns the requested day. Upcoming uses the same-day response when available;
  // callers can choose a future date to inspect upcoming fixtures.
  matches=classify(matches,view,date);
  const payload={ok:true,matches,view,date};const ttl=Math.max(15,Math.min(3600,Number(settings.public_livescore_cache_seconds||settings.cache_seconds||60)));await db.from("football_public_cache").upsert({cache_key:cacheKey,payload,provider_name:provider.provider_name,fetched_at:now.toISOString(),expires_at:new Date(now.getTime()+ttl*1000).toISOString()});return reply(200,{...payload,provider:provider.provider_name,cached:false});
 }catch(e){return reply(502,{ok:false,error:e instanceof Error?e.message:"Football data unavailable",matches:[]});}
});
