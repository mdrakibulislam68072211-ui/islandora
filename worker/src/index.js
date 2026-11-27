// Islandora game API — staging review build only.
// Preserves the existing Firebase auth-sync and signup-bonus behavior.
// Do not deploy until staging tests and explicit production approval.

let jwksCache = null, jwksExpiresAt = 0;
const PROJECT = "islandora-c1f7b";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const CORS = {
  // Only the dedicated integration preview may call this staging API.
  "Access-Control-Allow-Origin": "https://feature-complete-game-integr.islandora.pages.dev",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
  "Content-Type": "application/json"
};
const ISLAND_UNLOCK = [500,1000,2000,4000,8000,16000,32000,64000,128000,256000];
const BOX_PRICES_1 = [10,20,30,50,100,150,200,300,500,1000];
const BOX_RATES_1 = [2,4,6,10,20,30,40,50,100,200];
// Initial defaults for Islands 2–10: box prices scale 2x per island;
// mining rates scale 1.5x per island. Admin-configurable in a later admin API.
const ISLAND_ONE_STORAGE_CAP = 1500, CLAIM_MIN = 5, EXCHANGE_FEE_BPS = 100;

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
  if(claims.aud!==PROJECT||claims.iss!=="https://securetoken.google.com/"+PROJECT||!claims.sub||claims.sub.length>128||claims.sub!==claims.user_id||!claims.exp||claims.exp<=now||!claims.iat||claims.iat>now+300||!claims.auth_time||claims.auth_time>now+300)throw new Error("Expired or invalid token");
  return claims;
}
async function loadGameConfig(env){
  const {results=[]}=await env.DB.prepare("SELECT island_number,unlock_cost_gems,box_prices_json,box_rates_json,storage_cap FROM island_configs ORDER BY island_number").all();
  return Array.from({length:10},(_,i)=>{
    const n=i+1,row=results.find(x=>Number(x.island_number)===n);
    const factor=Math.pow(2,i),rateFactor=Math.pow(1.5,i);
    let prices,rates;
    try{prices=JSON.parse(row?.box_prices_json||"");}catch{}
    try{rates=JSON.parse(row?.box_rates_json||"");}catch{}
    if(!Array.isArray(prices)||prices.length!==10)prices=BOX_PRICES_1.map(x=>Math.round(x*factor));
    if(!Array.isArray(rates)||rates.length!==10)rates=BOX_RATES_1.map(x=>Math.round(x*rateFactor));
    return {island_number:n,unlock_cost_gems:Number(row?.unlock_cost_gems??ISLAND_UNLOCK[i]),box_prices:prices.map(Number),box_rates:rates.map(Number),storage_cap:Number(row?.storage_cap??(i===0?1500:0))};
  });
}
function cfg(config,island,box){
  const row=config[island-1];
  return {price:Number(row.box_prices[box-1]),rate:Number(row.box_rates[box-1])};
}
function idem(v){return typeof v==="string"&&/^[A-Za-z0-9_-]{12,100}$/.test(v);}
async function body(req){try{return await req.json();}catch{return null;}}
async function getUser(env,uid){return env.DB.prepare("SELECT firebase_uid,email,gems,coins,signup_bonus_granted,account_status FROM users WHERE firebase_uid=?").bind(uid).first();}
async function ensureActive(env,uid){const u=await getUser(env,uid);if(!u||u.account_status!=="active")throw new Error("Account unavailable");return u;}

// Settles each unlocked island independently. The guarded timestamp update prevents
// two concurrent requests from crediting the same elapsed interval twice.
async function settle(env,uid,config){
  const now=Date.now();
  const {results=[]}=await env.DB.prepare("SELECT island_number,pending_coins,last_mining_at FROM user_islands WHERE firebase_uid=? AND is_unlocked=1").bind(uid).all();
  for(const row of results){
    if(!row.last_mining_at)continue;
    const then=Date.parse(String(row.last_mining_at).replace(" ","T")+"Z");
    if(!Number.isFinite(then)||now<=then)continue;
    const {results:boxes=[]}=await env.DB.prepare("SELECT box_number,open_count FROM user_island_boxes WHERE firebase_uid=? AND island_number=?").bind(uid,row.island_number).all();
    let perDay=0;for(const b of boxes)perDay+=b.open_count*cfg(config,row.island_number,b.box_number).rate;
    if(perDay<=0)continue;
    const elapsed=(now-then)/86400000;
    const earned=elapsed*perDay;
    if(earned<=0)continue;
    const configuredCap=Number(config[row.island_number-1]?.storage_cap||0);
    const newPending=configuredCap>0?Math.min(configuredCap,Number(row.pending_coins||0)+earned):Number(row.pending_coins||0)+earned;
    const timestamp=new Date(now).toISOString().slice(0,19).replace("T"," ");
    await env.DB.prepare("UPDATE user_islands SET pending_coins=?,last_mining_at=? WHERE firebase_uid=? AND island_number=? AND last_mining_at=?")
      .bind(newPending,timestamp,uid,row.island_number,row.last_mining_at).run();
  }
}
async function gameState(env,uid){
  const config=await loadGameConfig(env);
  await settle(env,uid,config);
  const user=await getUser(env,uid);
  const {results:islands=[]}=await env.DB.prepare("SELECT island_number,is_unlocked,pending_coins,last_mining_at FROM user_islands WHERE firebase_uid=? ORDER BY island_number").bind(uid).all();
  const {results:boxes=[]}=await env.DB.prepare("SELECT island_number,box_number,open_count FROM user_island_boxes WHERE firebase_uid=? ORDER BY island_number,box_number").bind(uid).all();
  const islandRows=Array.from({length:10},(_,i)=>{
    const n=i+1,stored=islands.find(x=>x.island_number===n),isUnlocked=!!stored?.is_unlocked;
    const b=Array.from({length:10},(_,j)=>{const c=cfg(config,n,j+1);return {box_number:j+1,price_gems:c.price,rate_coins_per_day:c.rate,open_count:boxes.find(x=>x.island_number===n&&x.box_number===j+1)?.open_count||0};});
    return {island_number:n,unlock_cost_gems:config[i].unlock_cost_gems,storage_cap:config[i].storage_cap,is_unlocked:isUnlocked,pending_coins:Number(stored?.pending_coins||0),boxes:b};
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
  const config=await loadGameConfig(env);
  const price=config[n-1].unlock_cost_gems;
  if(n>1){const prev=await env.DB.prepare("SELECT COUNT(*) AS total, COALESCE(MIN(open_count),0) AS min_open FROM user_island_boxes WHERE firebase_uid=? AND island_number=?").bind(uid,n-1).first();if(Number(prev?.total)!==10||Number(prev?.min_open)<10)return json({success:false,error:"Open all 10 boxes 10 times on the previous island first"},409);}
  const already=await env.DB.prepare("SELECT is_unlocked FROM user_islands WHERE firebase_uid=? AND island_number=?").bind(uid,n).first();
  if(already?.is_unlocked)return json({success:true,message:"Island already unlocked"});
  const stmts=[
    env.DB.prepare("UPDATE users SET gems=gems-? WHERE firebase_uid=? AND gems>=? AND NOT EXISTS(SELECT 1 FROM user_islands WHERE firebase_uid=? AND island_number=? AND is_unlocked=1) AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?) AND (?=1 OR EXISTS(SELECT 1 FROM user_island_boxes WHERE firebase_uid=? AND island_number=? GROUP BY firebase_uid,island_number HAVING COUNT(*)=10 AND MIN(open_count)=10))")
      .bind(price,uid,price,uid,n,idemKey,n,uid,n-1),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ? ,?,'Gems',?,?,?, ?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),uid,-price,"island_unlock","Unlock Island "+n,String(n),idemKey),
    env.DB.prepare("INSERT INTO user_islands(id,firebase_uid,island_number,is_unlocked,pending_coins,last_mining_at,unlocked_at) SELECT ?,?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='island_unlock') ON CONFLICT(firebase_uid,island_number) DO UPDATE SET is_unlocked=1,last_mining_at=CURRENT_TIMESTAMP,unlocked_at=CURRENT_TIMESTAMP")
      .bind(crypto.randomUUID(),uid,n,idemKey,uid)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Gems or duplicate request"},409);return json({success:true,island_number:n,cost_gems:price});}
  catch(e){console.error(e);return json({success:false,error:"Island unlock failed"},500);}
}
async function processReferralOutbox(env, onlyUid=null) {
  if (!env.REFERRAL_API_URL || !env.INTERNAL_API_SECRET) return;
  const sql = onlyUid
    ? "SELECT id,referred_uid,attempts FROM referral_callback_outbox WHERE status='pending' AND next_attempt_at<=CURRENT_TIMESTAMP AND referred_uid=? ORDER BY created_at LIMIT 10"
    : "SELECT id,referred_uid,attempts FROM referral_callback_outbox WHERE status='pending' AND next_attempt_at<=CURRENT_TIMESTAMP ORDER BY created_at LIMIT 10";
  const q = onlyUid ? env.DB.prepare(sql).bind(onlyUid) : env.DB.prepare(sql);
  const { results=[] } = await q.all();
  for (const item of results) {
    try {
      const response = await fetch(env.REFERRAL_API_URL + "/internal/referral/box-opened", {
        method:"POST", headers:{"Content-Type":"application/json","X-Internal-Secret":env.INTERNAL_API_SECRET},
        body:JSON.stringify({referred_uid:item.referred_uid})
      });
      if (response.ok) {
        await env.DB.prepare("UPDATE referral_callback_outbox SET status='delivered',updated_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=? AND status='pending'").bind(item.id).run();
      } else {
        const delay=Math.min(21600,60*Math.pow(2,Math.min(Number(item.attempts)||0,8)));
        await env.DB.prepare("UPDATE referral_callback_outbox SET attempts=attempts+1,next_attempt_at=datetime('now','+'||?||' seconds'),last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(delay,"HTTP "+response.status,item.id).run();
      }
    } catch (error) {
      const delay=Math.min(21600,60*Math.pow(2,Math.min(Number(item.attempts)||0,8)));
      await env.DB.prepare("UPDATE referral_callback_outbox SET attempts=attempts+1,next_attempt_at=datetime('now','+'||?||' seconds'),last_error='network error',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(delay,item.id).run();
    }
  }
}

async function openBox(env,uid,b){
  const n=Number(b?.island_number),box=Number(b?.box_number),key=b?.idempotency_key;
  if(!Number.isInteger(n)||n<1||n>10||!Number.isInteger(box)||box<1||box>10||!idem(key))return json({success:false,error:"Invalid island, box or idempotency key"},400);
  const unlocked=await env.DB.prepare("SELECT is_unlocked FROM user_islands WHERE firebase_uid=? AND island_number=?").bind(uid,n).first();
  if(!unlocked?.is_unlocked)return json({success:false,error:"Island is locked"},403);
  const config=await loadGameConfig(env);
  await settle(env,uid,config);
  const {price}=cfg(config,n,box);
  const stmts=[
    env.DB.prepare("UPDATE users SET gems=gems-? WHERE firebase_uid=? AND gems>=? AND EXISTS(SELECT 1 FROM user_islands WHERE firebase_uid=? AND island_number=? AND is_unlocked=1) AND COALESCE((SELECT open_count FROM user_island_boxes WHERE firebase_uid=? AND island_number=? AND box_number=?),0)<10 AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)")
      .bind(price,uid,price,uid,n,uid,n,box,key),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Gems',?,'box_open',?,?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),uid,-price,"Open Island "+n+" Box "+box,String(n)+":"+String(box),key),
    env.DB.prepare("INSERT INTO user_island_boxes(id,firebase_uid,island_number,box_number,open_count) SELECT ?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='box_open') ON CONFLICT(firebase_uid,island_number,box_number) DO UPDATE SET open_count=MIN(10,open_count+1),updated_at=CURRENT_TIMESTAMP WHERE user_island_boxes.open_count<10")
      .bind(crypto.randomUUID(),uid,n,box,key,uid),
    env.DB.prepare("UPDATE user_islands SET last_mining_at=CURRENT_TIMESTAMP WHERE firebase_uid=? AND island_number=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='box_open')")
      .bind(uid,n,key,uid),
    env.DB.prepare("INSERT OR IGNORE INTO referral_callback_outbox(id,referred_uid) SELECT ?,? WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='box_open')").bind(crypto.randomUUID(),uid,key,uid),
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Gems or duplicate request"},409);
    try{await processReferralOutbox(env,uid);}catch(err){console.error('Referral outbox deferred');}
    return json({success:true,island_number:n,box_number:box,price_gems:price});}
  catch(e){console.error(e);return json({success:false,error:"Box opening failed"},500);}
}
async function claim(env,uid,b){
  const n=Number(b?.island_number),key=b?.idempotency_key;
  if(!Number.isInteger(n)||n<1||n>10||!idem(key))return json({success:false,error:"Invalid island or idempotency key"},400);
  const config=await loadGameConfig(env);
  await settle(env,uid,config);
  const row=await env.DB.prepare("SELECT pending_coins FROM user_islands WHERE firebase_uid=? AND island_number=? AND is_unlocked=1").bind(uid,n).first();
  const pending=Number(row?.pending_coins||0);
  const amount=Math.floor(pending);
  if(amount<CLAIM_MIN)return json({success:false,error:"At least 5 whole pending Coins are required"},409);
  const stmts=[
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Coins',?,'mining_claim',?,?,? WHERE EXISTS(SELECT 1 FROM user_islands WHERE firebase_uid=? AND island_number=? AND is_unlocked=1 AND pending_coins>=?) AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)")
      .bind(crypto.randomUUID(),uid,amount,"Claim Island "+n,String(n),key,uid,n,amount,key),
    env.DB.prepare("UPDATE user_islands SET pending_coins=pending_coins-? WHERE firebase_uid=? AND island_number=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='mining_claim')")
      .bind(amount,uid,n,key,uid),
    env.DB.prepare("UPDATE users SET coins=coins+? WHERE firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='mining_claim')")
      .bind(amount,uid,key,uid)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Claim unavailable or duplicate request"},409);return json({success:true,claimed_coins:amount});}
  catch(e){console.error(e);return json({success:false,error:"Claim failed"},500);}
}
async function createWithdrawal(env,uid,b){
  const amount=Number(b?.amount),method=String(b?.payment_method||"");
  const details=String(b?.payment_details||"").trim(),key=b?.idempotency_key;
  const methods=["USDT","bKash","Nagad","Rocket","Payeer"];
  if(!Number.isSafeInteger(amount)||amount<10000||amount>1000000000||!methods.includes(method)||details.length<4||details.length>500||!idem(key))
    return json({success:false,error:"Enter a valid amount, payment method and payment details"},400);
  const valid=await env.DB.prepare("SELECT COUNT(*) AS total FROM referrals WHERE referrer_uid=? AND is_valid=1").bind(uid).first();
  if(Number(valid?.total||0)<5)return json({success:false,error:"At least 5 valid referrals are required"},403);
  const id=crypto.randomUUID();
  const stmts=[
    env.DB.prepare("UPDATE users SET coins=coins-? WHERE firebase_uid=? AND coins>=? AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(amount,uid,amount,key),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Coins',?,'withdrawal_request','Coins reserved for withdrawal',?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),uid,-amount,id,key),
    env.DB.prepare("INSERT INTO withdrawal_requests(id,firebase_uid,amount,payment_method,payment_details,status) SELECT ?,?,?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='withdrawal_request')")
      .bind(id,uid,amount,method,details,key,uid)
  ];
  try{
    const r=await env.DB.batch(stmts);
    if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Coins or duplicate request"},409);
    return json({success:true,withdrawal_id:id,status:"pending",reserved_coins:amount});
  }catch(e){console.error(e);return json({success:false,error:"Withdrawal request failed"},500);}
}
async function listWithdrawals(env,uid){
  const {results=[]}=await env.DB.prepare("SELECT id,amount,payment_method,status,admin_note,processed_at,created_at FROM withdrawal_requests WHERE firebase_uid=? ORDER BY created_at DESC LIMIT 50").bind(uid).all();
  return json({success:true,withdrawals:results});
}
async function requireAdmin(env,uid){
  return await env.DB.prepare("SELECT role FROM admin_users WHERE firebase_uid=? AND is_active=1").bind(uid).first();
}
async function adminOverview(env,uid){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const [users,wallet,withdrawals,referrals]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM users").first(),
    env.DB.prepare("SELECT COALESCE(SUM(gems),0) AS gems,COALESCE(SUM(coins),0) AS coins FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS pending FROM withdrawal_requests WHERE status='pending'").first(),
    env.DB.prepare("SELECT COUNT(*) AS valid FROM referrals WHERE is_valid=1").first()
  ]);
  return json({success:true,admin_role:admin.role,users:Number(users?.total||0),total_gems:Number(wallet?.gems||0),total_coins:Number(wallet?.coins||0),pending_withdrawals:Number(withdrawals?.pending||0),valid_referrals:Number(referrals?.valid||0)});
}
async function adminUsers(env,uid,search=""){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const term="%"+String(search).slice(0,80)+"%";
  const {results=[]}=await env.DB.prepare("SELECT firebase_uid,email,gems,coins,account_status,created_at FROM users WHERE email LIKE ? OR firebase_uid LIKE ? ORDER BY created_at DESC LIMIT 100").bind(term,term).all();
  return json({success:true,users:results});
}
async function adminAdjustWallet(env,uid,b){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const target=String(b?.user_uid||""),currency=String(b?.currency||""),amount=Number(b?.amount),key=b?.idempotency_key;
  if(!target||target.length>128||!["Gems","Coins"].includes(currency)||!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1000000000||!idem(key))
    return json({success:false,error:"Invalid wallet adjustment"},400);
  const column=currency==="Gems"?"gems":"coins";
  try{
    const r=await env.DB.batch([
      env.DB.prepare(`UPDATE users SET ${column}=${column}+? WHERE firebase_uid=? AND ${column}+?>=0 AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)`).bind(amount,target,amount,key),
      env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,?,?,'admin_adjustment',?,?,? WHERE changes()=1")
        .bind(crypto.randomUUID(),target,currency,amount,String(b?.description||"Admin balance adjustment").slice(0,180),uid,key)
    ]);
    if(!r[0]?.meta?.changes)return json({success:false,error:"User not found, insufficient balance or duplicate request"},409);
    try{await env.DB.prepare("INSERT INTO admin_activity_logs(id,admin_uid,action,target_uid,details) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),uid,"wallet_adjustment",target,JSON.stringify({currency,amount,description:b?.description||""})).run();}catch(e){console.error("Audit log failed",e);}
    return json({success:true,user_uid:target,currency,adjustment:amount});
  }catch(e){console.error(e);return json({success:false,error:"Wallet adjustment failed"},500);}
}
async function adminIslandConfig(env,uid){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  return json({success:true,islands:await loadGameConfig(env),admin_role:admin.role});
}
async function updateAdminIslandConfig(env,uid,b){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const n=Number(b?.island_number),unlock=Number(b?.unlock_cost_gems),cap=Number(b?.storage_cap);
  const prices=b?.box_prices,rates=b?.box_rates;
  const validArray=a=>Array.isArray(a)&&a.length===10&&a.every(x=>Number.isSafeInteger(Number(x))&&Number(x)>=0&&Number(x)<=1000000000);
  if(!Number.isInteger(n)||n<1||n>10||!Number.isSafeInteger(unlock)||unlock<0||unlock>1000000000||!Number.isFinite(cap)||cap<0||cap>100000000000||!validArray(prices)||!validArray(rates))
    return json({success:false,error:"Invalid island configuration"},400);
  try{
    await env.DB.prepare("UPDATE island_configs SET unlock_cost_gems=?,box_prices_json=?,box_rates_json=?,storage_cap=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE island_number=?")
      .bind(unlock,JSON.stringify(prices.map(Number)),JSON.stringify(rates.map(Number)),cap,uid,n).run();
    await env.DB.prepare("INSERT INTO admin_activity_logs(id,admin_uid,action,details) VALUES(?,?,?,?)")
      .bind(crypto.randomUUID(),uid,"island_config_update",JSON.stringify({island_number:n,unlock_cost_gems:unlock,storage_cap:cap})).run();
    return json({success:true,island:(await loadGameConfig(env))[n-1]});
  }catch(e){console.error(e);return json({success:false,error:"Island configuration update failed"},500);}
}
async function adminWithdrawals(env,uid){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const {results=[]}=await env.DB.prepare("SELECT id,firebase_uid,amount,payment_method,payment_details,status,admin_note,created_at FROM withdrawal_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 200").all();
  return json({success:true,withdrawals:results,admin_role:admin.role});
}
async function reviewWithdrawal(env,uid,b){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const id=String(b?.withdrawal_id||""),status=String(b?.status||""),note=String(b?.admin_note||"").trim().slice(0,500);
  if(!id||id.length>64||!["approved","rejected"].includes(status))return json({success:false,error:"Invalid withdrawal review"},400);
  const request=await env.DB.prepare("SELECT firebase_uid,amount,status FROM withdrawal_requests WHERE id=?").bind(id).first();
  if(!request)return json({success:false,error:"Withdrawal not found"},404);
  if(request.status!=="pending")return json({success:false,error:"Withdrawal has already been processed"},409);
  const stmts=[
    env.DB.prepare("UPDATE withdrawal_requests SET status=?,admin_note=?,processed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(status,note,id),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,firebase_uid,'Coins',amount,'withdrawal_refund','Refund for rejected withdrawal',id,? FROM withdrawal_requests WHERE id=? AND status='rejected' AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)")
      .bind(crypto.randomUUID(),"withdrawal_refund:"+id,id,"withdrawal_refund:"+id),
    env.DB.prepare("UPDATE users SET coins=coins+(SELECT amount FROM withdrawal_requests WHERE id=?) WHERE firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='withdrawal_refund')")
      .bind(id,request.firebase_uid,"withdrawal_refund:"+id,request.firebase_uid)
  ];
  try{
    const r=await env.DB.batch(stmts);
    if(!r[0]?.meta?.changes)return json({success:false,error:"Withdrawal was already processed"},409);
    try {
      await env.DB.prepare("INSERT INTO admin_activity_logs(id,admin_uid,action,target_uid,details) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(),uid,"withdrawal_"+status,request.firebase_uid,JSON.stringify({withdrawal_id:id,amount:request.amount,note})).run();
    } catch (logError) { console.error("Admin audit log write failed", logError); }
    return json({success:true,withdrawal_id:id,status,refunded:status==="rejected"});
  }catch(e){console.error(e);return json({success:false,error:"Withdrawal review failed"},500);}
}
async function exchange(env,uid,b){
  const amount=Number(b?.coins),key=b?.idempotency_key;
  if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000||!idem(key))return json({success:false,error:"Enter a valid whole Coin amount and idempotency key"},400);
  const fee=Math.ceil(amount*EXCHANGE_FEE_BPS/10000),gems=amount-fee;if(gems<1)return json({success:false,error:"Amount is too small after fee"},400);
  const stmts=[
    env.DB.prepare("UPDATE users SET coins=coins-? WHERE firebase_uid=? AND coins>=?").bind(amount,uid,amount),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Coins',?,'coin_to_gem_exchange','Exchange Coins to Gems (1% fee)',?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),uid,-amount,String(gems),key),
    env.DB.prepare("UPDATE users SET gems=gems+? WHERE firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='coin_to_gem_exchange')").bind(gems,uid,key,uid),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Gems',?,'coin_to_gem_exchange','Received Gems after 1% exchange fee',?,? WHERE EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='coin_to_gem_exchange')")
      .bind(crypto.randomUUID(),uid,gems,String(amount),key+"_gems",key,uid)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Coins or duplicate request"},409);return json({success:true,coins_spent:amount,fee_coins:fee,gems_received:gems,fee_percent:1});}
  catch(e){console.error(e);return json({success:false,error:"Exchange failed"},500);}
}
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
    if(u.pathname==="/api/withdrawals"&&req.method==="GET")return listWithdrawals(env,c.sub);
    if(u.pathname==="/api/withdrawals"&&req.method==="POST")return createWithdrawal(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/overview"&&req.method==="GET")return adminOverview(env,c.sub);
    if(u.pathname==="/api/admin/users"&&req.method==="GET")return adminUsers(env,c.sub,u.searchParams.get("q")||"");
    if(u.pathname==="/api/admin/wallet/adjust"&&req.method==="POST")return adminAdjustWallet(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/islands"&&req.method==="GET")return adminIslandConfig(env,c.sub);
    if(u.pathname==="/api/admin/islands"&&req.method==="POST")return updateAdminIslandConfig(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/withdrawals"&&req.method==="GET")return adminWithdrawals(env,c.sub);
    if(u.pathname==="/api/admin/withdrawals/review"&&req.method==="POST")return reviewWithdrawal(env,c.sub,await body(req));
    return json({success:false,error:"Route not found"},404);
  }catch(e){console.error(e);return json({success:false,error:"Game request failed"},500);}
}};
