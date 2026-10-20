import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const url=Deno.env.get("SUPABASE_URL"), anonKey=Deno.env.get("SUPABASE_ANON_KEY"), serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), authHeader=req.headers.get("Authorization")||"";
  if(!url||!anonKey||!serviceKey) return reply(500,{error:"Server environment is missing Supabase secrets."});
  if(!authHeader.startsWith("Bearer ")) return reply(401,{error:"Sign in as Admin 1 (Owner) first."});
  const userClient=createClient(url,anonKey,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await userClient.auth.getUser(); if(userError||!userData.user)return reply(401,{error:"Your session is invalid or expired. Sign in again."});
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:actor,error:actorError}=await admin.from("admin_profiles").select("user_id,role,is_suspended").eq("user_id",userData.user.id).maybeSingle();
  if(actorError||!actor||actor.role!=="owner"||actor.is_suspended)return reply(403,{error:"Only active Admin 1 (Owner) can add administrators."});
  let body:{email?:string;username?:string;password?:string;confirm_password?:string;display_name?:string};try{body=await req.json()}catch{return reply(400,{error:"Request body must be valid JSON."})}
  const email=String(body.email||"").trim().toLowerCase(), password=String(body.password||""), confirmPassword=String(body.confirm_password||""), displayName=String(body.display_name||body.username||"Administrator").trim().slice(0,100)||"Administrator";
  let username=String(body.username||"").trim().toLowerCase().replace(/[^a-z0-9_.-]/g,"_").slice(0,32);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply(400,{error:"Enter a valid email address. If you prefer a username, also provide a valid recovery email."});
  if(password.length<8)return reply(400,{error:"Password must contain at least 8 characters."});
  if(password!==confirmPassword)return reply(400,{error:"Password and confirm password do not match."});
  if(!username)username=email.split("@")[0].replace(/[^a-z0-9_.-]/g,"_").slice(0,32)||"admin";
  const {data:current,error:listError}=await admin.from("admin_profiles").select("user_id");if(listError)return reply(500,{error:"Could not check administrator limit."});if((current||[]).length>=11)return reply(409,{error:"PARROTHIT allows 11 administrators total, including the owner."});
  const {data:existing,error:usernameError}=await admin.from("admin_profiles").select("user_id").ilike("username",username).maybeSingle();if(usernameError)return reply(500,{error:"Could not check username availability."});if(existing)return reply(409,{error:"That username already exists. Try another email prefix."});
  const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:displayName,username}});if(createError||!created.user)return reply(400,{error:createError?.message||"Could not create this administrator."});
  const {error:profileError}=await admin.from("admin_profiles").insert({user_id:created.user.id,username,email,display_name:displayName,role:"admin",is_suspended:false});
  if(profileError){await admin.auth.admin.deleteUser(created.user.id);return reply(500,{error:"Account creation was rolled back because the admin profile could not be created: "+profileError.message});}
  await admin.from("admin_audit_log").insert({actor:userData.user.id,action:"add_admin",target_type:"admin_profile",target_id:created.user.id,details:{email,username,display_name:displayName}});
  return reply(200,{success:true,user_id:created.user.id,username,message:"Administrator account created."});
});
