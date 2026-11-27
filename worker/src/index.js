export default {async scheduled(controller,env,ctx){await processReferralOutbox(env);},async fetch(req,env){
  const u=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if((u.pathname==="/"||u.pathname==="/health")&&req.method==="GET"){
    try{const r=await env.DB.prepare("SELECT 1 AS connected").first();return json({success:true,app:"Islandora",worker:"online",database:r?.connected===1?"connected":"error"});}
    catch{return json({success:false,error:"Database unavailable"},500);}
  }
  if(u.pathname==="/api/auth/sync"&&req.method==="POST")return syncUser(req,env);
  let c;try{c=await auth(req);await ensureActive(env,c.sub);}catch(e){return json({success:false,error:"Unauthorized",message:e.message},401);}
  try{
    if(u.pathname==="/api/game/state"&&req.method==="GET")return json(await gameState(env,c.sub));
    if(u.pathname==="/api/game/island/unlock"&&req.method==="POST")return unlock(env,c.sub,await body(req));
    if(u.pathname==="/api/game/box/open"&&req.method==="POST")return openBox(env,c.sub,await body(req));
    if(u.pathname==="/api/game/claim"&&req.method==="POST")return claim(env,c.sub,await body(req));
    if(u.pathname==="/api/game/exchange"&&req.method==="POST")return exchange(env,c.sub,await body(req));
    return json({success:false,error:"Route not found"},404);
  }catch(e){console.error(e);return json({success:false,error:"Game request failed"},500);}
}};
