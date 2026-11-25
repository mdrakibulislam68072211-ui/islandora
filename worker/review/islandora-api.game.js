// Islandora game API — staging review build only.
// Preserves the existing Firebase auth-sync and signup-bonus behavior.
// Do not deploy until staging tests and explicit production approval.

let jwksCache = null, jwksExpiresAt = 0;
const PROJECT = "islandora-c1f7b";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CORS = {
  "Access-Control-Allow-Origin": "https://islandora.pages.dev",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};
const ISLAND_UNLOCK = [500,1000,2000,4000,8000,16000,32000,64000,128000,256000];
const BOX_PRICES_1 = [10,20,30,50,100,150,200,300,500,1000];
const BOX_RATES_1 = [2,4,6,10,20,30,40,50,100,200];
// Initial defaults for Islands 2–10: box prices scale 2x per island;
// mining rates scale 1.5x per island. Admin-configurable in a later admin API.
const STORAGE_CAP = 1500, CLAIM_MIN = 5, EXCHANGE_FEE_BPS = 100;

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:CORS});}
function b64(v){v=v.replace(/-/g,"+").replace(/_/g,"/");v=v.padEnd(Math.ceil(v.length/4)*4,"=");return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
function jwtPart(v){return JSON.parse(new TextDecoder().decode(b64(v)));}
async function keys(force=false){
  if(!force&&jwksCache&&Date.now()<jwksExpiresAt)return jwksCache;
  const r=await fetch(JWKS_URL,{cf:{cacheTtl:3600,cacheEverything:true}});
  if(!r.ok)throw new Error("Firebase key lookup failed");
  const d=await r.json();jwksCache=d.keys;jwksExpiresAt=Date.now()+3600000;return jwksCache;
}
async function auth(req){
  const h=req.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer "))throw new Error("Authentication required");
  const p=h.slice(7).trim().split(".");
  if(p.length!==3)throw new Error("Invalid token");
  const head=jwtPart(p[0]),claims=jwtPart(p[1]);
  if(head.alg!=="RS256"||!head.kid)throw new Error("Invalid token algorithm");
  let k=(await keys()).find(x=>x.kid===head.kid);
  if(!k)k=(await keys(true)).find(x=>x.kid===head.kid);
  if(!k)throw new Error("Unknown signing key");
  const pub=await crypto.subtle.importKey("jwk",k,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",pub,b64(p[2]),new TextEncoder().encode(p[0]+"."+p[1])))throw new Error("Invalid signature");
  const now=Math.floor(Date.now()/1000);
  if(claims.aud!==PROJECT||claims.iss!=="https://securetoken.google.com/"+PROJECT||!claims.sub||claims.sub.length>128||!claims.exp||claims.exp<=now||!claims.iat||claims.iat>now+300||!claims.auth_time||claims.auth_time>now+300)throw new Error("Expired or invalid token");
  return claims;
}
function cfg(island,box){
  const factor=Math.pow(2,island-1),rateFactor=Math.pow(1.5,island-1);
  return {price:Math.round(BOX_PRICES_1[box-1]*factor),rate:Math.round(BOX_RATES_1[box-1]*rateFactor)};
}
function idem(v){return typeof v==="string"&&/^[A-Za-z0-9_-]{12,100}$/.test(v);}
async function body(req){try{return await req.json();}catch{return null;}}
async function getUser(env,uid){return env.DB.prepare("SELECT firebase_uid,email,gems,coins,signup_bonus_granted,account_status FROM users WHERE firebase_uid=?").bind(uid).first();}
async function ensureActive(env,uid){const u=await getUser(env,uid);if(!u||u.account_status!=="active")throw new Error("Account unavailable");return u;}

// Settles each unlocked island independently. The guarded timestamp update prevents
// two concurrent requests from crediting the same elapsed interval twice.
async function settle(env,uid){
  const now=Date.now();
  const {results=[]}=await env.DB.prepare("SELECT island_number,pending_coins,last_mining_at FROM user_islands WHERE firebase_uid=? AND is_unlocked=1").bind(uid).all();
  for(const row of results){
    if(!row.last_mining_at)continue;
    const then=Date.parse(String(row.last_mining_at).replace(" ","T")+"Z");
    if(!Number.isFinite(then)||now<=then)continue;
    const {results:boxes=[]}=await env.DB.prepare("SELECT box_number,open_count FROM user_island_boxes WHERE firebase_uid=? AND island_number=?").bind(uid,row.island_number).all();
    let perDay=0;for(const b of boxes)perDay+=b.open_count*cfg(row.island_number,b.box_number).rate;
    if(perDay<=0)continue;
    const elapsed=(now-then)/86400000;
    const earned=elapsed*perDay;
    if(earned<=0)continue;
    const newPending=Math.min(STORAGE_CAP,Number(row.pending_coins||0)+earned);
    const timestamp=new Date(now).toISOString().slice(0,19).replace("T"," ");
    await env.DB.prepare("UPDATE user_islands SET pending_coins=?,last_mining_at=? WHERE firebase_uid=? AND island_number=? AND last_mining_at=?")
      .bind(newPending,timestamp,uid,row.island_number,row.last_mining_at).run();
  }
}
async function gameState(env,uid){
  await settle(env,uid);
  const user=await getUser(env,uid);
  const {results:islands=[]}=await env.DB.prepare("SELECT island_number,is_unlocked,pending_coins,last_mining_at FROM user_islands WHERE firebase_uid=? ORDER BY island_number").bind(uid).all();
  const {results:boxes=[]}=await env.DB.prepare("SELECT island_number,box_number,open_count FROM user_island_boxes WHERE firebase_uid=? ORDER BY island_number,box_number").bind(uid).all();
  const islandRows=Array.from({length:10},(_,i)=>{
    const n=i+1,stored=islands.find(x=>x.island_number===n),isUnlocked=!!stored?.is_unlocked;
    const b=Array.from({length:10},(_,j)=>{const c=cfg(n,j+1);return {box_number:j+1,price_gems:c.price,rate_coins_per_day:c.rate,open_count:boxes.find(x=>x.island_number===n&&x.box_number===j+1)?.open_count||0};});
    return {island_number:n,unlock_cost_gems:ISLAND_UNLOCK[i],is_unlocked:isUnlocked,pending_coins:Number(stored?.pending_coins||0),boxes:b};
  });
  return {success:true,user:{gems:user.gems,coins:user.coins},exchange:{coins_per_gem:1,fee_percent:1},islands:islandRows};
}
async function syncUser(req,env){
  let c;try{c=await auth(req);}catch(e){return json({success:false,error:"Unauthorized",message:e.message},401);}
  const uid=c.sub,email=c.email||"";if(!email)return json({success:false,error:"Email not available"},400);
  try{
    await env.DB.prepare("INSERT INTO users(firebase_uid,email,gems,coins,signup_bonus_granted,account_status) VALUES(?,?,1000,0,1,'active') ON CONFLICT(firebase_uid) DO NOTHING").bind(uid,email).run();
    await env.DB.prepare("UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE firebase_uid=?").bind(email,uid).run();
    const user=await getUser(env,uid);if(!user||user.account_status!=="active")return json({success:false,error:"Account unavailable"},403);
    return json({success:true,user});
  }catch(e){console.error(e);return json({success:false,error:"Unable to synchronize account"},500);}
}
async function unlock(env,uid,b){
  const n=Number(b?.island_number);if(!Number.isInteger(n)||n<1||n>10)return json({success:false,error:"Invalid island"},400);
  const idemKey=b.idempotency_key;if(!idem(idemKey))return json({success:false,error:"A valid idempotency_key is required"},400);
  const price=ISLAND_UNLOCK[n-1];
  if(n>1){const prev=await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(MIN(open_count),0) AS min_open FROM user_island_boxes WHERE firebase_uid=? AND island_number=?").bind(uid,n-1).first();if(Number(prev?.total)!==10||Number(prev?.min_open)<10)return json({success:false,error:"Open all 10 boxes 10 times on the previous island first"},409);}
  const already=await env.DB.prepare("SELECT is_unlocked FROM user_islands WHERE firebase_uid=? AND island_number=?").bind(uid,n).first();
  if(already?.is_unlocked)return json({success:true,message:"Island already unlocked"});
  const stmts=[
    env.DB.prepare("UPDATE users SET gems=gems-? WHERE firebase_uid=? AND gems>=?").bind(price,uid,price),
    env.DB.prepare("INSERT INTO wallet_transactions(firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,'Gems',?,?,?, ?,? WHERE changes()=1").bind(uid,-price,"island_unlock","Unlock Island "+n,String(n),idemKey),
    env.DB.prepare("INSERT INTO user_islands(firebase_uid,island_number,is_unlocked,pending_coins,last_mining_at,unlocked_at) SELECT ?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?) ON CONFLICT(firebase_uid,island_number) DO UPDATE SET is_unlocked=1").bind(uid,n,idemKey)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Gems or duplicate request"},409);return json({success:true,island_number:n,cost_gems:price});}
  catch(e){console.error(e);return json({success:false,error:"Island unlock failed"},500);}
}
async function openBox(env,uid,b){
  const n=Number(b?.island_number),box=Number(b?.box_number),key=b?.idempotency_key;
  if(!Number.isInteger(n)||n<1||n>10||!Number.isInteger(box)||box<1||box>10||!idem(key))return json({success:false,error:"Invalid island, box or idempotency key"},400);
  const unlocked=await env.DB.prepare("SELECT is_unlocked FROM user_islands WHERE firebase_uid=? AND island_number=?").bind(uid,n).first();
  if(!unlocked?.is_unlocked)return json({success:false,error:"Island is locked"},403);
  const existing=await env.DB.prepare("SELECT open_count FROM user_island_boxes WHERE firebase_uid=? AND island_number=? AND box_number=?").bind(uid,n,box).first();
  if(Number(existing?.open_count||0)>=10)return json({success:false,error:"This box is already maxed"},409);
  await settle(env,uid);
  const {price}=cfg(n,box);
  const stmts=[
    env.DB.prepare("UPDATE users SET gems=gems-? WHERE firebase_uid=? AND gems>=?").bind(price,uid,price),
    env.DB.prepare("INSERT INTO wallet_transactions(firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,'Gems',?,'box_open',?,?,? WHERE changes()=1").bind(uid,-price,"Open Island "+n+" Box "+box,String(n)+":"+String(box),key),
    env.DB.prepare("INSERT INTO user_island_boxes(firebase_uid,island_number,box_number,open_count) SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?) ON CONFLICT(firebase_uid,island_number,box_number) DO UPDATE SET open_count=MIN(10,open_count+1),updated_at=CURRENT_TIMESTAMP").bind(uid,n,box,key),
    env.DB.prepare("UPDATE user_islands SET last_mining_at=CURRENT_TIMESTAMP WHERE firebase_uid=? AND island_number=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(uid,n,key),
    env.DB.prepare("UPDATE referrals SET is_valid=1,valid_at=CURRENT_TIMESTAMP WHERE referred_uid=? AND is_valid=0 AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(uid,key)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Gems or duplicate request"},409);return json({success:true,island_number:n,box_number:box,price_gems:price});}
  catch(e){console.error(e);return json({success:false,error:"Box opening failed"},500);}
}
async function claim(env,uid,b){
  const n=Number(b?.island_number),key=b?.idempotency_key;
  if(!Number.isInteger(n)||n<1||n>10||!idem(key))return json({success:false,error:"Invalid island or idempotency key"},400);
  await settle(env,uid);
  const row=await env.DB.prepare("SELECT pending_coins FROM user_islands WHERE firebase_uid=? AND island_number=? AND is_unlocked=1").bind(uid,n).first();
  const amount=Number(row?.pending_coins||0);if(amount<CLAIM_MIN)return json({success:false,error:"At least 5 pending Coins are required"},409);
  const stmts=[
    env.DB.prepare("INSERT INTO wallet_transactions(firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,'Coins',?,'mining_claim',?,?,? WHERE EXISTS(SELECT 1 FROM user_islands WHERE firebase_uid=? AND island_number=? AND pending_coins>=5)").bind(uid,amount,"Claim Island "+n,String(n),key,uid,n),
    env.DB.prepare("UPDATE user_islands SET pending_coins=0 WHERE firebase_uid=? AND island_number=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(uid,n,key),
    env.DB.prepare("UPDATE users SET coins=coins+(SELECT amount FROM wallet_transactions WHERE idempotency_key=?) WHERE firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(key,uid,key)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Claim unavailable or duplicate request"},409);return json({success:true,claimed_coins:amount});}
  catch(e){console.error(e);return json({success:false,error:"Claim failed"},500);}
}
async function exchange(env,uid,b){
  const amount=Number(b?.coins),key=b?.idempotency_key;
  if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000||!idem(key))return json({success:false,error:"Enter a valid whole Coin amount and idempotency key"},400);
  const fee=Math.ceil(amount*EXCHANGE_FEE_BPS/10000),gems=amount-fee;if(gems<1)return json({success:false,error:"Amount is too small after fee"},400);
  const stmts=[
    env.DB.prepare("UPDATE users SET coins=coins-? WHERE firebase_uid=? AND coins>=?").bind(amount,uid,amount),
    env.DB.prepare("INSERT INTO wallet_transactions(firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,'Coins',?,'coin_to_gem_exchange','Exchange Coins to Gems (1% fee)',?,? WHERE changes()=1").bind(uid,-amount,String(gems),key),
    env.DB.prepare("UPDATE users SET gems=gems+? WHERE firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(gems,uid,key),
    env.DB.prepare("INSERT INTO wallet_transactions(firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,'Gems',?,'coin_to_gem_exchange','Received Gems after 1% exchange fee',?,? WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(uid,gems,String(amount),key+"_gems",key)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Coins or duplicate request"},409);return json({success:true,coins_spent:amount,fee_coins:fee,gems_received:gems,fee_percent:1});}
  catch(e){console.error(e);return json({success:false,error:"Exchange failed"},500);}
}
export default {async fetch(req,env){
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
