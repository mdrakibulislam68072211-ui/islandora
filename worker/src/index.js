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
    return {island_number:n,unlock_cost_gems:config[i].unlock_cost_gems,storage_cap:config[i].storage_cap,is_unlocked:isUnlocked,pending_coins:Number(stored?.pending_coins||0),last_mining_at:stored?.last_mining_at||null,boxes:b};
  });
  return {success:true,user:{gems:user.gems,coins:user.coins},exchange:{coins_per_gem:1,fee_percent:1},islands:islandRows};
}

async function verifyTelegramInitData(initData,botToken){
  if(typeof initData!=="string"||!initData||initData.length>8192||!botToken)throw new Error("Telegram data unavailable");
  const params=new URLSearchParams(initData), received=params.get("hash");
  if(!received||!/^[a-f0-9]{64}$/i.test(received))throw new Error("Invalid Telegram signature");
  params.delete("hash");
  const pairs=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v);
  const checkString=pairs.join("\n");
  const enc=new TextEncoder();
  const keyMaterial=await crypto.subtle.importKey("raw",enc.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const secret=await crypto.subtle.sign("HMAC",keyMaterial,enc.encode(botToken));
  const hmacKey=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const expected=[...new Uint8Array(await crypto.subtle.sign("HMAC",hmacKey,enc.encode(checkString)))].map(x=>x.toString(16).padStart(2,"0")).join("");
  let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^received.toLowerCase().charCodeAt(i);
  if(diff!==0)throw new Error("Telegram signature verification failed");
  const authDate=Number(params.get("auth_date")),now=Math.floor(Date.now()/1000);
  if(!Number.isInteger(authDate)||authDate>now+60||now-authDate>86400)throw new Error("Telegram login data expired");
  let user;try{user=JSON.parse(params.get("user")||"{}");}catch{throw new Error("Invalid Telegram user data");}
  if(!user.id||!Number.isSafeInteger(Number(user.id)))throw new Error("Telegram user ID missing");
  return {telegramUserId:String(user.id),username:typeof user.username==="string"?user.username.slice(0,64):null,authDate};
}
async function linkTelegramAccount(req,env,uid){
  if(!env.TELEGRAM_BOT_TOKEN)return json({success:false,error:"Telegram integration is not configured"},503);
  const b=await body(req);
  let verified;try{verified=await verifyTelegramInitData(b?.init_data,env.TELEGRAM_BOT_TOKEN);}catch(e){return json({success:false,error:e.message},401);}
  try{
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS telegram_accounts (
      telegram_user_id TEXT PRIMARY KEY,
      firebase_uid TEXT NOT NULL UNIQUE,
      username TEXT,
      linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(firebase_uid) REFERENCES users(firebase_uid)
    )`).run();
    const existing=await env.DB.prepare("SELECT firebase_uid FROM telegram_accounts WHERE telegram_user_id=? OR firebase_uid=?").bind(verified.telegramUserId,uid).all();
    const rows=existing.results||[];
    if(rows.some(x=>x.firebase_uid!==uid))return json({success:false,error:"This Telegram account or Islandora account is already linked elsewhere"},409);
    await env.DB.prepare(`INSERT INTO telegram_accounts(telegram_user_id,firebase_uid,username)
      VALUES(?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET
      username=excluded.username,last_seen_at=CURRENT_TIMESTAMP
      WHERE telegram_accounts.firebase_uid=excluded.firebase_uid`)
      .bind(verified.telegramUserId,uid,verified.username).run();
    const linked=await env.DB.prepare("SELECT telegram_user_id,username,linked_at FROM telegram_accounts WHERE firebase_uid=?").bind(uid).first();
    if(!linked)return json({success:false,error:"Account link conflict"},409);
    return json({success:true,linked:true,telegram:{id:linked.telegram_user_id,username:linked.username},linked_at:linked.linked_at});
  }catch(e){console.error("Telegram account link failed",e);return json({success:false,error:"Unable to link Telegram account"},500);}
}

async function telegramSendStart(env,chatId,startPayload){
  if(!env.TELEGRAM_BOT_TOKEN)return;
  const code=String(startPayload||"").match(/^ref_([a-f0-9]{16})$/i)?.[1]?.toLowerCase()||"";
  const appUrl="https://feature-complete-game-integr.islandora.pages.dev/"+(code?"?ref="+encodeURIComponent(code):"");
  const text=code
    ?"Welcome to Islandora! Open the Mini App to create your account. Your referral code has been saved."
    :"Welcome to Islandora! Open the Mini App to sign in or create your account and start mining.";
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,reply_markup:{inline_keyboard:[[{text:"Open Islandora",web_app:{url:appUrl}}]]}})
  });
  if(!response.ok)throw new Error("Telegram sendMessage failed: "+response.status);
}
async function telegramWebhook(req,env){
  const secret=env.TELEGRAM_WEBHOOK_SECRET;
  if(!secret)return json({success:false,error:"Telegram webhook secret is not configured"},503);
  if(req.headers.get("X-Telegram-Bot-Api-Secret-Token")!==secret)return json({success:false,error:"Unauthorized"},401);
  const update=await body(req);
  const message=update?.message;
  const startParts=typeof message?.text==="string"?message.text.trim().split(" "):[];
  const isStart=startParts[0]==="/start"||startParts[0]==="/start@Islandora_Bot";
  const match=isStart?["/start",startParts[1]||""]:null;
  if(message?.chat?.id&&match){
    try{await telegramSendStart(env,message.chat.id,match[1]||"");}
    catch(e){console.error("Telegram start reply failed",e);return json({success:false,error:"Unable to send Telegram reply"},502);}
  }
  return json({success:true,received:true});
}
async function configureTelegramWebhook(req,env){
  const secret=env.TELEGRAM_WEBHOOK_SECRET;
  if(!secret||req.headers.get("X-Webhook-Setup-Secret")!==secret)return json({success:false,error:"Unauthorized"},401);
  if(!env.TELEGRAM_BOT_TOKEN)return json({success:false,error:"Telegram bot token is missing"},503);
  const webhookUrl="https://islandora-staging-api.mdrakibulislam68072211.workers.dev/api/telegram/webhook";
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/setWebhook",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({url:webhookUrl,secret_token:secret,allowed_updates:["message"],drop_pending_updates:false})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)return json({success:false,error:"Telegram rejected webhook configuration",details:data.description||response.status},502);
  return json({success:true,webhook_configured:true});
}
async function syncUser(req,env){
  let c;try{c=await auth(req);}catch(e){return json({success:false,error:"Unauthorized",message:e.message},401);}
  const uid=c.sub,email=c.email||"";if(!email)return json({success:false,error:"Email not available"},400);
  try{
    await env.DB.prepare("INSERT INTO users(firebase_uid,email,gems,coins,signup_bonus_granted,account_status) VALUES(?,?,COALESCE((SELECT CAST(value AS INTEGER) FROM app_settings WHERE key='signup_bonus_gems'),1000),0,1,'active') ON CONFLICT(firebase_uid) DO NOTHING").bind(uid,email).run();
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
    env.DB.prepare("INSERT INTO user_islands(id,firebase_uid,island_number,is_unlocked,pending_coins,last_mining_at,unlocked_at) SELECT ?,?,?,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE changes()=1 AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='island_unlock') ON CONFLICT(firebase_uid,island_number) DO UPDATE SET is_unlocked=1,last_mining_at=CURRENT_TIMESTAMP,unlocked_at=CURRENT_TIMESTAMP")
      .bind(crypto.randomUUID(),uid,n,idemKey,uid)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Gems or duplicate request"},409);await creditReferralCommissions(env,uid);return json({success:true,island_number:n,cost_gems:price});}
  catch(e){console.error(e);return json({success:false,error:"Island unlock failed"},500);}
}
async function creditReferralCommissions(env,referredUid){
  // 15% of qualifying Gems spent becomes Coins, held in thousandths so
  // fractional commission is preserved until the referrer claims whole Coins.
  await env.DB.prepare(`INSERT OR IGNORE INTO referral_commission_ledger
    (id,referrer_uid,referred_uid,source_transaction_id,spent_gems,commission_milli_coins)
    SELECT lower(hex(randomblob(16))),r.referrer_uid,r.referred_uid,w.id,ABS(w.amount),ABS(w.amount)*150
    FROM referrals r
    JOIN wallet_transactions w ON w.firebase_uid=r.referred_uid
    WHERE r.referred_uid=? AND r.is_valid=1
      AND w.currency='Gems' AND w.amount<0
      AND w.transaction_type IN ('box_open','island_unlock')
      AND NOT EXISTS(SELECT 1 FROM referral_commission_ledger l WHERE l.source_transaction_id=w.id)`)
    .bind(referredUid).run();
}
async function referralCommissionInfo(env,uid){
  const row=await env.DB.prepare(`SELECT
    COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_ledger WHERE referrer_uid=?),0)-
    COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_claims WHERE referrer_uid=?),0) AS balance_milli,
    COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_ledger WHERE referrer_uid=?),0) AS earned_milli,
    (SELECT COUNT(*) FROM referrals WHERE referrer_uid=? AND is_valid=1) AS valid_referrals`)
    .bind(uid,uid,uid,uid).first();
  return json({success:true,balance_coins:Number(row?.balance_milli||0)/1000,
    earned_coins:Number(row?.earned_milli||0)/1000,
    claimable_coins:Math.floor(Number(row?.balance_milli||0)/1000),
    valid_referrals:Number(row?.valid_referrals||0),minimum_claim:5});
}
async function claimReferralCommission(env,uid,b){
  const key=b?.idempotency_key;
  if(!idem(key))return json({success:false,error:"A valid idempotency_key is required"},400);
  const row=await env.DB.prepare(`SELECT
    COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_ledger WHERE referrer_uid=?),0)-
    COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_claims WHERE referrer_uid=?),0) AS balance_milli`)
    .bind(uid,uid).first();
  const coins=Math.floor(Number(row?.balance_milli||0)/1000);
  if(coins<5)return json({success:false,error:"At least 5 whole referral Coins are required to claim"},409);
  const consumed=coins*1000;
  try{
    const r=await env.DB.batch([
      env.DB.prepare(`INSERT INTO referral_commission_claims
        (id,referrer_uid,commission_milli_coins,coins_claimed,idempotency_key)
        SELECT ?,?,?,?,?
        WHERE (
          COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_ledger WHERE referrer_uid=?),0)-
          COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_claims WHERE referrer_uid=?),0)
        )>=?
        AND NOT EXISTS(SELECT 1 FROM referral_commission_claims WHERE idempotency_key=?)`)
        .bind(crypto.randomUUID(),uid,consumed,coins,key,uid,uid,consumed,key),
      env.DB.prepare(`INSERT INTO wallet_transactions
        (id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key)
        SELECT ?,?,'Coins',?,'referral_commission_claim','Claim referral commission',?,?
        WHERE changes()=1`)
        .bind(crypto.randomUUID(),uid,coins,key,key),
      env.DB.prepare(`UPDATE users SET coins=coins+?
        WHERE firebase_uid=? AND changes()=1`).bind(coins,uid)
    ]);
    if(!r[0]?.meta?.changes)return json({success:false,error:"Referral balance is below minimum or request already used"},409);
    const remaining=await env.DB.prepare(`SELECT
      COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_ledger WHERE referrer_uid=?),0)-
      COALESCE((SELECT SUM(commission_milli_coins) FROM referral_commission_claims WHERE referrer_uid=?),0) AS balance_milli`).bind(uid,uid).first();
    return json({success:true,claimed_coins:coins,remaining_coins:Number(remaining?.balance_milli||0)/1000});
  }catch(e){console.error(e);return json({success:false,error:"Referral commission claim failed"},500);}
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
        await creditReferralCommissions(env,item.referred_uid);
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
    env.DB.prepare("INSERT INTO user_island_boxes(id,firebase_uid,island_number,box_number,open_count) SELECT ?,?,?,?,1 WHERE changes()=1 AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='box_open') ON CONFLICT(firebase_uid,island_number,box_number) DO UPDATE SET open_count=MIN(10,open_count+1),updated_at=CURRENT_TIMESTAMP WHERE user_island_boxes.open_count<10")
      .bind(crypto.randomUUID(),uid,n,box,key,uid),
    env.DB.prepare("UPDATE user_islands SET last_mining_at=CURRENT_TIMESTAMP WHERE changes()=1 AND firebase_uid=? AND island_number=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='box_open')")
      .bind(uid,n,key,uid),
    env.DB.prepare("INSERT OR IGNORE INTO referral_callback_outbox(id,referred_uid) SELECT ?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='box_open')").bind(crypto.randomUUID(),uid,key,uid),
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Gems or duplicate request"},409);
    try{await processReferralOutbox(env,uid);}catch(err){console.error('Referral outbox deferred');}
    await creditReferralCommissions(env,uid);
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
    env.DB.prepare("UPDATE user_islands SET pending_coins=pending_coins-? WHERE changes()=1 AND firebase_uid=? AND island_number=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='mining_claim')")
      .bind(amount,uid,n,key,uid),
    env.DB.prepare("UPDATE users SET coins=coins+? WHERE changes()=1 AND firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='mining_claim')")
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
    env.DB.prepare("INSERT INTO withdrawal_requests(id,firebase_uid,amount,payment_method,payment_details,status) SELECT ?,?,?,?,?,'pending' WHERE changes()=1 AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='withdrawal_request')")
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
async function startMonetagReward(env,uid,b){
  if(!env.MONETAG_POSTBACK_SECRET)return json({success:false,error:"Monetag server verification is not configured"},503);
  const id=String(b?.ad_setting_id||"");
  const ad=await env.DB.prepare("SELECT id,placement_id,settings_json,cooldown_hours,daily_limit,reward_coins FROM ad_settings WHERE id=? AND provider='Monetag' AND ad_type='rewarded' AND enabled=1").bind(id).first();
  let settings={};try{settings=JSON.parse(ad?.settings_json||"{}");}catch{}
  if(!ad||!/^\d{3,20}$/.test(String(ad.placement_id||""))||!String(settings.sdk_script_url||"").startsWith("https://"))return json({success:false,error:"Rewarded ad SDK is not configured"},404);
  if(Number(ad.daily_limit)<=0||Number(ad.reward_coins)<=0)return json({success:false,error:"Rewarded ad is currently disabled"},403);
  const ymid=crypto.randomUUID();
  try{
    const activity=await env.DB.prepare(`INSERT INTO user_ad_activity(firebase_uid,ad_setting_id,day_key,opens_today,last_opened_at)
      VALUES(?,?,date('now'),1,CURRENT_TIMESTAMP)
      ON CONFLICT(firebase_uid,ad_setting_id) DO UPDATE SET
       opens_today=CASE WHEN user_ad_activity.day_key=date('now') THEN user_ad_activity.opens_today+1 ELSE 1 END,
       day_key=date('now'),last_opened_at=CURRENT_TIMESTAMP
      WHERE user_ad_activity.last_opened_at<=datetime('now','-'||?||' hours')
        AND (user_ad_activity.day_key<>date('now') OR user_ad_activity.opens_today<?)`)
      .bind(uid,id,Number(ad.cooldown_hours),Number(ad.daily_limit)).run();
    if(!activity.meta?.changes)return json({success:false,error:"Rewarded ad cooldown or daily limit reached"},429);
    await env.DB.prepare("INSERT INTO monetag_reward_events(ymid,firebase_uid,reward_coins,status) VALUES(?,?,?,'pending')")
      .bind(ymid,uid,Number(ad.reward_coins)).run();
    return json({success:true,ymid,placement_id:ad.placement_id,sdk_script_url:settings.sdk_script_url,reward_coins:Number(ad.reward_coins)});
  }catch(e){console.error(e);return json({success:false,error:"Could not start rewarded ad"},500);}
}
async function monetagPostback(req,env){
  const u=new URL(req.url),secret=u.searchParams.get("secret")||"";
  if(!env.MONETAG_POSTBACK_SECRET)return json({success:false,error:"Postback secret not configured"},503);
  if(!secret||secret!==env.MONETAG_POSTBACK_SECRET)return json({success:false,error:"Unauthorized postback"},403);
  const ymid=String(u.searchParams.get("ymid")||"");
  const eventType=String(u.searchParams.get("event_type")||"");
  const rewardType=String(u.searchParams.get("reward_event_type")||"");
  const price=String(u.searchParams.get("estimated_price")||"");
  if(!/^[0-9a-f-]{36}$/i.test(ymid)||!["impression","click"].includes(eventType)||!["valued","non_valued"].includes(rewardType))
    return json({success:false,error:"Invalid postback fields"},400);
  const event=await env.DB.prepare("SELECT firebase_uid,reward_coins,status FROM monetag_reward_events WHERE ymid=?").bind(ymid).first();
  if(!event)return json({success:false,error:"Unknown ad event"},404);
  if(event.status!=="pending")return json({success:true,duplicate:true});
  // Impression and click callbacks can arrive in either order and share one ymid.
  // Keep non-valued events pending; a later valued event for the same show may still qualify.
  if(rewardType!=="valued"){
    await env.DB.prepare("UPDATE monetag_reward_events SET event_type=?,reward_event_type=?,estimated_price=? WHERE ymid=? AND status='pending'")
      .bind(eventType,rewardType,price,ymid).run();
    return json({success:true,credited:false,pending:true});
  }
  const key="monetag_reward:"+ymid;
  try{
    const r=await env.DB.batch([
      env.DB.prepare("UPDATE monetag_reward_events SET status='credited',event_type=?,reward_event_type=?,estimated_price=?,credited_at=CURRENT_TIMESTAMP WHERE ymid=? AND status='pending'").bind(eventType,rewardType,price,ymid),
      env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,firebase_uid,'Coins',?,'monetag_ad_reward','Verified Monetag rewarded ad',ymid,? FROM monetag_reward_events WHERE changes()=1 AND ymid=? AND status='credited' AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)")
        .bind(crypto.randomUUID(),Number(event.reward_coins),key,ymid,key),
      env.DB.prepare("UPDATE users SET coins=coins+? WHERE changes()=1 AND firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=?)")
        .bind(Number(event.reward_coins),event.firebase_uid,key,event.firebase_uid)
    ]);
    return json({success:true,credited:Number(r[1]?.meta?.changes||0)===1});
  }catch(e){console.error(e);return json({success:false,error:"Reward processing failed"},500);}
}
async function monetagRewardStatus(env,uid,ymid){
  if(!/^[0-9a-f-]{36}$/i.test(ymid))return json({success:false,error:"Invalid ad event"},400);
  const row=await env.DB.prepare("SELECT status,reward_coins FROM monetag_reward_events WHERE ymid=? AND firebase_uid=?").bind(ymid,uid).first();
  if(!row)return json({success:false,error:"Ad event not found"},404);
  return json({success:true,status:row.status,reward_coins:row.status==="credited"?Number(row.reward_coins):0});
}
async function listAdPlacements(env,uid){
  const {results=[]}=await env.DB.prepare("SELECT id,provider,ad_type,name,placement_id,settings_json,cooldown_hours,daily_limit,reward_coins FROM ad_settings WHERE enabled=1 ORDER BY provider").all();
  return json({success:true,ads:results.filter(ad=>ad.provider!=="Monetag"||!!env.MONETAG_POSTBACK_SECRET)});
}
async function openDirectAd(env,uid,b){
  const id=String(b?.ad_setting_id||"");
  if(!id||id.length>64)return json({success:false,error:"Invalid ad placement"},400);
  const ad=await env.DB.prepare("SELECT id,direct_link_url,cooldown_hours,daily_limit FROM ad_settings WHERE id=? AND provider='Adsterra' AND ad_type='direct_link' AND enabled=1").bind(id).first();
  if(!ad)return json({success:false,error:"Ad placement unavailable"},404);
  if(Number(ad.daily_limit)<=0)return json({success:false,error:"This ad is currently disabled"},403);
  try{
    const r=await env.DB.prepare(`INSERT INTO user_ad_activity(firebase_uid,ad_setting_id,day_key,opens_today,last_opened_at)
      VALUES(?,?,date('now'),1,CURRENT_TIMESTAMP)
      ON CONFLICT(firebase_uid,ad_setting_id) DO UPDATE SET
       opens_today=CASE WHEN user_ad_activity.day_key=date('now') THEN user_ad_activity.opens_today+1 ELSE 1 END,
       day_key=date('now'),last_opened_at=CURRENT_TIMESTAMP
      WHERE user_ad_activity.last_opened_at<=datetime('now','-'||?||' hours')
        AND (user_ad_activity.day_key<>date('now') OR user_ad_activity.opens_today<?)`)
      .bind(uid,id,Number(ad.cooldown_hours),Number(ad.daily_limit)).run();
    if(!r.meta?.changes)return json({success:false,error:"Ad cooldown or daily limit reached"},429);
    return json({success:true,url:ad.direct_link_url,cooldown_hours:Number(ad.cooldown_hours)});
  }catch(e){console.error(e);return json({success:false,error:"Ad could not be opened"},500);}
}
async function spinState(env,uid){
  const [settings,ad,attempt,options]=await Promise.all([
    env.DB.prepare("SELECT enabled,daily_limit FROM spin_settings WHERE id=1").first(),
    env.DB.prepare("SELECT id,direct_link_url FROM ad_settings WHERE provider='Adsterra' AND ad_type='direct_link' AND enabled=1").first(),
    env.DB.prepare("SELECT id,reward_coins,status,ad_opened_at,verified_at,claimed_at FROM spin_attempts WHERE firebase_uid=? AND day_key=date('now','+6 hours')").bind(uid).first(),
    env.DB.prepare("SELECT reward_coins,probability_bps FROM spin_reward_options WHERE enabled=1 ORDER BY sort_order").all()
  ]);
  const verificationReady=!!env.ADSTERRA_POSTBACK_SECRET&&!!ad?.direct_link_url;
  return json({success:true,enabled:Number(settings?.enabled||0)===1&&verificationReady,verification_ready:verificationReady,
    reason:!verificationReady?"Adsterra completion verification is not configured":null,
    daily_limit:1,remaining_spins:attempt?0:1,attempt:attempt||null,reward_options:options.results||[]});
}
async function spinNow(env,uid,b){
  const key=b?.idempotency_key;
  if(!idem(key))return json({success:false,error:"A valid idempotency key is required"},400);
  const [settings,ad]=await Promise.all([
    env.DB.prepare("SELECT enabled FROM spin_settings WHERE id=1").first(),
    env.DB.prepare("SELECT id,direct_link_url FROM ad_settings WHERE provider='Adsterra' AND ad_type='direct_link' AND enabled=1").first()
  ]);
  if(Number(settings?.enabled||0)!==1)return json({success:false,error:"Daily Spin is disabled"},403);
  if(!ad?.direct_link_url||!env.ADSTERRA_POSTBACK_SECRET)return json({success:false,error:"Adsterra completion verification is not configured. No locked reward can be issued yet."},503);
  const existing=await env.DB.prepare("SELECT id,reward_coins,status,ad_opened_at,verified_at,claimed_at FROM spin_attempts WHERE firebase_uid=? AND day_key=date('now','+6 hours')").bind(uid).first();
  if(existing)return json({success:true,already_spun:true,attempt:existing,daily_limit:1});
  const {results=[]}=await env.DB.prepare("SELECT reward_coins,probability_bps FROM spin_reward_options WHERE enabled=1 ORDER BY sort_order").all();
  const total=results.reduce((sum,x)=>sum+Number(x.probability_bps||0),0);
  if(!results.length||total!==10000||results.some(x=>!Number.isSafeInteger(Number(x.reward_coins))||Number(x.reward_coins)<=0))
    return json({success:false,error:"Spin reward probabilities must total exactly 100%"},503);
  const random=new Uint32Array(1);crypto.getRandomValues(random);
  const roll=random[0]%10000;
  let cursor=0,reward=Number(results[results.length-1].reward_coins);
  for(const option of results){cursor+=Number(option.probability_bps);if(roll<cursor){reward=Number(option.reward_coins);break;}}
  const id=crypto.randomUUID(),psid=crypto.randomUUID().replace(/-/g,"");
  try{
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO spin_attempts
      (id,firebase_uid,day_key,reward_coins,status,adsterra_psid,idempotency_key)
      SELECT ?,?,date('now','+6 hours'),?,'locked',?,?
      WHERE NOT EXISTS(SELECT 1 FROM spin_attempts WHERE firebase_uid=? AND day_key=date('now','+6 hours'))`)
      .bind(id,uid,reward,psid,key,uid).run();
    const attempt=await env.DB.prepare("SELECT id,reward_coins,status,ad_opened_at,verified_at,claimed_at FROM spin_attempts WHERE firebase_uid=? AND day_key=date('now','+6 hours')").bind(uid).first();
    if(!attempt)return json({success:false,error:"Daily spin could not be created"},409);
    return json({success:true,already_spun:!inserted.meta?.changes,attempt,daily_limit:1});
  }catch(e){console.error(e);return json({success:false,error:"Daily spin failed"},500);}
}
async function openSpinAd(env,uid,b){
  const id=String(b?.spin_id||"");
  if(!id||id.length>64)return json({success:false,error:"Invalid spin attempt"},400);
  if(!env.ADSTERRA_POSTBACK_SECRET)return json({success:false,error:"Adsterra completion verification is not configured"},503);
  const [attempt,ad]=await Promise.all([
    env.DB.prepare("SELECT id,adsterra_psid,status,ad_opened_at FROM spin_attempts WHERE id=? AND firebase_uid=?").bind(id,uid).first(),
    env.DB.prepare("SELECT id,direct_link_url,cooldown_hours FROM ad_settings WHERE provider='Adsterra' AND ad_type='direct_link' AND enabled=1").first()
  ]);
  if(!attempt||!ad)return json({success:false,error:"Spin or Adsterra placement not found"},404);
  if(attempt.status!=="locked"||attempt.ad_opened_at)return json({success:false,error:"This spin ad has already been opened or verified"},409);
  try{
    const target=new URL(ad.direct_link_url);
    target.searchParams.set("psid",attempt.adsterra_psid);
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO user_ad_activity(firebase_uid,ad_setting_id,day_key,opens_today,last_opened_at)
        VALUES(?,?,date('now','+6 hours'),1,CURRENT_TIMESTAMP)
        ON CONFLICT(firebase_uid,ad_setting_id) DO UPDATE SET
         opens_today=CASE WHEN user_ad_activity.day_key=date('now','+6 hours') THEN user_ad_activity.opens_today+1 ELSE 1 END,
         day_key=date('now','+6 hours'),last_opened_at=CURRENT_TIMESTAMP
        WHERE user_ad_activity.last_opened_at<=datetime('now','-'||?||' hours')
          AND (user_ad_activity.day_key<>date('now','+6 hours') OR user_ad_activity.opens_today<1)
          AND EXISTS(SELECT 1 FROM spin_attempts WHERE id=? AND firebase_uid=? AND status='locked' AND ad_opened_at IS NULL)`)
        .bind(uid,ad.id,Number(ad.cooldown_hours),id,uid),
      env.DB.prepare("UPDATE spin_attempts SET ad_opened_at=CURRENT_TIMESTAMP WHERE changes()=1 AND id=? AND firebase_uid=? AND status='locked' AND ad_opened_at IS NULL").bind(id,uid)
    ]);
    if(!result[0]?.meta?.changes)return json({success:false,error:"Adsterra link daily limit reached"},429);
    if(!result[1]?.meta?.changes)return json({success:false,error:"Spin ad could not be opened"},409);
    return json({success:true,url:target.toString(),status:"locked",message:"Opening the ad does not unlock the reward. Server verification is required."});
  }catch(e){console.error(e);return json({success:false,error:"Adsterra link could not be opened"},500);}
}
async function claimSpinReward(env,uid,b){
  const id=String(b?.spin_id||"");
  if(!id||id.length>64)return json({success:false,error:"Invalid spin attempt"},400);
  const attempt=await env.DB.prepare("SELECT reward_coins,status FROM spin_attempts WHERE id=? AND firebase_uid=?").bind(id,uid).first();
  if(!attempt)return json({success:false,error:"Spin attempt not found"},404);
  if(attempt.status!=="verified")return json({success:false,error:"Adsterra has not verified completion. Reward remains locked."},403);
  const key="spin_reward:"+id;
  try{
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE spin_attempts SET status='claimed',claimed_at=CURRENT_TIMESTAMP WHERE id=? AND firebase_uid=? AND status='verified' AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(id,uid,key),
      env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Coins',?,'daily_spin_reward','Verified daily spin reward',?,? WHERE changes()=1")
        .bind(crypto.randomUUID(),uid,Number(attempt.reward_coins),id,key),
      env.DB.prepare("UPDATE users SET coins=coins+? WHERE changes()=1 AND firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=?)")
        .bind(Number(attempt.reward_coins),uid,key,uid)
    ]);
    if(!result[0]?.meta?.changes)return json({success:false,error:"Spin reward was already claimed"},409);
    return json({success:true,claimed_coins:Number(attempt.reward_coins)});
  }catch(e){console.error(e);return json({success:false,error:"Spin reward claim failed"},500);}
}
async function adsterraSpinPostback(req,env){
  if(!env.ADSTERRA_POSTBACK_SECRET)return json({success:false,error:"Adsterra postback secret is not configured"},503);
  const u=new URL(req.url),secret=u.searchParams.get("secret")||"",psid=String(u.searchParams.get("psid")||""),status=u.searchParams.get("status")||"";
  if(!secret||secret!==env.ADSTERRA_POSTBACK_SECRET)return json({success:false,error:"Unauthorized postback"},403);
  if(!/^[0-9a-f]{32}$/i.test(psid)||status!=="approved")return json({success:false,error:"Invalid approval event"},400);
  const result=await env.DB.prepare("UPDATE spin_attempts SET status='verified',verified_at=CURRENT_TIMESTAMP WHERE adsterra_psid=? AND status='locked' AND ad_opened_at IS NOT NULL").bind(psid).run();
  if(result.meta?.changes)return json({success:true,verified:true});
  const existing=await env.DB.prepare("SELECT status FROM spin_attempts WHERE adsterra_psid=?").bind(psid).first();
  if(existing?.status==="verified"||existing?.status==="claimed")return json({success:true,duplicate:true});
  return json({success:false,error:"Matching opened spin attempt not found"},404);
}
async function adminSpin(env,uid){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const [settings,options]=await Promise.all([
    env.DB.prepare("SELECT enabled,daily_limit,updated_at FROM spin_settings WHERE id=1").first(),
    env.DB.prepare("SELECT reward_coins,probability_bps,enabled,sort_order FROM spin_reward_options ORDER BY sort_order").all()
  ]);
  return json({success:true,settings,options:options.results||[]});
}
async function saveAdminSpin(env,uid,b){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const enabled=b?.enabled?1:0,options=Array.isArray(b?.options)?b.options:[];
  if(options.length<2||options.length>20)return json({success:false,error:"Provide 2 to 20 spin rewards"},400);
  const seen=new Set();let total=0;
  for(const option of options){
    const reward=Number(option?.reward_coins),probability=Number(option?.probability_bps);
    if(!Number.isSafeInteger(reward)||reward<1||reward>1000000||!Number.isInteger(probability)||probability<0||probability>10000||seen.has(reward))
      return json({success:false,error:"Each reward must be unique and have a valid whole-number probability"},400);
    seen.add(reward);total+=probability;
  }
  if(total!==10000)return json({success:false,error:"Spin probabilities must total exactly 100%"},400);
  const stmts=[
    env.DB.prepare("UPDATE spin_settings SET enabled=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(enabled,uid),
    env.DB.prepare("DELETE FROM spin_reward_options")
  ];
  options.forEach((option,index)=>stmts.push(
    env.DB.prepare("INSERT INTO spin_reward_options(id,reward_coins,probability_bps,enabled,sort_order) VALUES(?,?,?,?,?)")
      .bind("spin-"+Number(option.reward_coins),Number(option.reward_coins),Number(option.probability_bps),1,index+1)
  ));
  stmts.push(env.DB.prepare("INSERT INTO admin_activity_logs(id,admin_uid,action,details) VALUES(?,?,?,?)")
    .bind(crypto.randomUUID(),uid,"spin_settings_update",JSON.stringify({enabled,options})));
  try{await env.DB.batch(stmts);return json({success:true,message:"Spin settings saved"});}
  catch(e){console.error(e);return json({success:false,error:"Spin settings could not be saved"},500);}
}
async function adminAds(env,uid){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const {results=[]}=await env.DB.prepare("SELECT id,provider,ad_type,name,enabled,direct_link_url,placement_id,settings_json,cooldown_hours,daily_limit,reward_coins,updated_at FROM ad_settings ORDER BY provider,ad_type").all();
  return json({success:true,ads:results});
}
async function saveAdminAd(env,uid,b){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const provider=String(b?.provider||""),type=String(b?.ad_type||""),name=String(b?.name||"").trim();
  const enabled=b?.enabled?1:0,url=String(b?.direct_link_url||"").trim(),placement=String(b?.placement_id||"").trim(),sdkUrl=String(b?.sdk_script_url||"").trim();
  const cooldown=Number(b?.cooldown_hours),limit=Number(b?.daily_limit),reward=Number(b?.reward_coins);
  if(!["Adsterra","Monetag"].includes(provider)||!["direct_link","rewarded"].includes(type)||!name||name.length>100||
     !Number.isInteger(cooldown)||cooldown<0||cooldown>720||!Number.isInteger(limit)||limit<0||limit>1000||
     !Number.isSafeInteger(reward)||reward<0||reward>1000000)
    return json({success:false,error:"Invalid ad settings"},400);
  if(provider==="Adsterra"&&type!=="direct_link")return json({success:false,error:"Adsterra is configured for direct links only"},400);
  if(provider==="Monetag"&&type!=="rewarded")return json({success:false,error:"Monetag is configured for rewarded ads only"},400);
  if(provider==="Adsterra"&&(!url.startsWith("https://")||url.length>2048))return json({success:false,error:"Enter a valid HTTPS direct link"},400);
  if(provider==="Monetag"&&(!/^\d{3,20}$/.test(placement)||!sdkUrl.startsWith("https://")||sdkUrl.length>2048))return json({success:false,error:"A numeric Monetag main zone ID and HTTPS SDK script URL are required"},400);
  if(provider==="Monetag"&&enabled&&!env.MONETAG_POSTBACK_SECRET)return json({success:false,error:"Configure the Monetag postback secret before enabling rewarded ads"},503);
  const id=crypto.randomUUID();
  try{
    await env.DB.prepare(`INSERT INTO ad_settings(id,provider,ad_type,name,enabled,direct_link_url,placement_id,cooldown_hours,daily_limit,reward_coins,updated_by,settings_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider,ad_type) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,direct_link_url=excluded.direct_link_url,placement_id=excluded.placement_id,settings_json=excluded.settings_json,cooldown_hours=excluded.cooldown_hours,daily_limit=excluded.daily_limit,reward_coins=excluded.reward_coins,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .bind(id,provider,type,name,enabled,provider==="Adsterra"?url:null,provider==="Monetag"?placement:null,cooldown,limit,reward,uid,provider==="Monetag"?JSON.stringify({sdk_script_url:sdkUrl}):null).run();
    await env.DB.prepare("INSERT INTO admin_activity_logs(id,admin_uid,action,details) VALUES(?,?,?,?)")
      .bind(crypto.randomUUID(),uid,"ad_settings_update",JSON.stringify({provider,ad_type:type,enabled})).run();
    return json({success:true,message:"Ad settings saved"});
  }catch(e){console.error(e);return json({success:false,error:"Ad settings could not be saved"},500);}
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
async function adminSignupBonus(env,uid){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const row=await env.DB.prepare("SELECT value FROM app_settings WHERE key='signup_bonus_gems'").first();
  return json({success:true,signup_bonus_gems:Number(row?.value??1000)});
}
async function updateAdminSignupBonus(env,uid,b){
  const admin=await requireAdmin(env,uid);
  if(!admin)return json({success:false,error:"Admin access required"},403);
  const amount=Number(b?.signup_bonus_gems);
  if(!Number.isSafeInteger(amount)||amount<0||amount>1000000000)
    return json({success:false,error:"Signup bonus must be a whole number between 0 and 1,000,000,000"},400);
  try{
    await env.DB.prepare("INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES('signup_bonus_gems',?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP")
      .bind(String(amount),uid).run();
    await env.DB.prepare("INSERT INTO admin_activity_logs(id,admin_uid,action,details) VALUES(?,?,?,?)")
      .bind(crypto.randomUUID(),uid,"signup_bonus_update",JSON.stringify({signup_bonus_gems:amount})).run();
    return json({success:true,signup_bonus_gems:amount,message:"Updated for future new accounts only"});
  }catch(e){console.error(e);return json({success:false,error:"Signup bonus setting could not be saved"},500);}
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
    env.DB.prepare("UPDATE users SET coins=coins+(SELECT amount FROM withdrawal_requests WHERE id=?) WHERE changes()=1 AND firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='withdrawal_refund')")
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
    env.DB.prepare("UPDATE users SET coins=coins-? WHERE firebase_uid=? AND coins>=? AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=?)").bind(amount,uid,amount,key),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Coins',?,'coin_to_gem_exchange','Exchange Coins to Gems (1% fee)',?,? WHERE changes()=1")
      .bind(crypto.randomUUID(),uid,-amount,String(gems),key),
    env.DB.prepare("UPDATE users SET gems=gems+? WHERE changes()=1 AND firebase_uid=? AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='coin_to_gem_exchange')").bind(gems,uid,key,uid),
    env.DB.prepare("INSERT INTO wallet_transactions(id,firebase_uid,currency,amount,transaction_type,description,reference_id,idempotency_key) SELECT ?,?,'Gems',?,'coin_to_gem_exchange','Received Gems after 1% exchange fee',?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM wallet_transactions WHERE idempotency_key=? AND firebase_uid=? AND transaction_type='coin_to_gem_exchange')")
      .bind(crypto.randomUUID(),uid,gems,String(amount),key+"_gems",key,uid)
  ];
  try{const r=await env.DB.batch(stmts);if(!r[0]?.meta?.changes)return json({success:false,error:"Insufficient Coins or duplicate request"},409);return json({success:true,coins_spent:amount,fee_coins:fee,gems_received:gems,fee_percent:1});}
  catch(e){console.error(e);return json({success:false,error:"Exchange failed"},500);}
}
export default {async scheduled(controller,env,ctx){await processReferralOutbox(env);try{await env.DB.prepare("UPDATE monetag_reward_events SET status='ignored' WHERE status='pending' AND created_at<=datetime('now','-48 hours')").run();}catch(e){console.error("Monetag event cleanup failed",e);}},async fetch(req,env){
  const u=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(u.pathname==="/api/telegram/webhook"&&req.method==="POST")return telegramWebhook(req,env);
  if((u.pathname==="/"||u.pathname==="/health")&&req.method==="GET"){
    try{const r=await env.DB.prepare("SELECT 1 AS connected").first();return json({success:true,app:"Islandora",worker:"online",database:r?.connected===1?"connected":"error"});}
    catch{return json({success:false,error:"Database unavailable"},500);}
  }
  if(u.pathname==="/api/ads/monetag/postback"&&req.method==="GET")return monetagPostback(req,env);
  if(u.pathname==="/api/spin/adsterra/postback"&&req.method==="GET")return adsterraSpinPostback(req,env);
  if(u.pathname==="/api/auth/sync"&&req.method==="POST")return syncUser(req,env);
  let c;try{c=await auth(req);await ensureActive(env,c.sub);}catch(e){return json({success:false,error:"Unauthorized",message:e.message},401);}
  try{
    if(u.pathname==="/api/telegram/link"&&req.method==="POST")return linkTelegramAccount(req,env,c.sub);
    if(u.pathname==="/api/spin/state"&&req.method==="GET")return spinState(env,c.sub);
    if(u.pathname==="/api/spin"&&req.method==="POST")return spinNow(env,c.sub,await body(req));
    if(u.pathname==="/api/spin/ad-open"&&req.method==="POST")return openSpinAd(env,c.sub,await body(req));
    if(u.pathname==="/api/spin/claim"&&req.method==="POST")return claimSpinReward(env,c.sub,await body(req));
    if(u.pathname==="/api/referral/commission"&&req.method==="GET")return referralCommissionInfo(env,c.sub);
    if(u.pathname==="/api/referral/commission/claim"&&req.method==="POST")return claimReferralCommission(env,c.sub,await body(req));
    if(u.pathname==="/api/game/state"&&req.method==="GET")return json(await gameState(env,c.sub));
    if(u.pathname==="/api/game/island/unlock"&&req.method==="POST")return unlock(env,c.sub,await body(req));
    if(u.pathname==="/api/game/box/open"&&req.method==="POST")return openBox(env,c.sub,await body(req));
    if(u.pathname==="/api/game/claim"&&req.method==="POST")return claim(env,c.sub,await body(req));
    if(u.pathname==="/api/game/exchange"&&req.method==="POST")return exchange(env,c.sub,await body(req));
    if(u.pathname==="/api/withdrawals"&&req.method==="GET")return listWithdrawals(env,c.sub);
    if(u.pathname==="/api/withdrawals"&&req.method==="POST")return createWithdrawal(env,c.sub,await body(req));
    if(u.pathname==="/api/ads/monetag/start"&&req.method==="POST")return startMonetagReward(env,c.sub,await body(req));
    if(u.pathname==="/api/ads/monetag/status"&&req.method==="GET")return monetagRewardStatus(env,c.sub,u.searchParams.get("ymid")||"");
    if(u.pathname==="/api/ads/placements"&&req.method==="GET")return listAdPlacements(env,c.sub);
    if(u.pathname==="/api/ads/direct-open"&&req.method==="POST")return openDirectAd(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/spin"&&req.method==="GET")return adminSpin(env,c.sub);
    if(u.pathname==="/api/admin/spin"&&req.method==="POST")return saveAdminSpin(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/ads"&&req.method==="GET")return adminAds(env,c.sub);
    if(u.pathname==="/api/admin/ads"&&req.method==="POST")return saveAdminAd(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/overview"&&req.method==="GET")return adminOverview(env,c.sub);
    if(u.pathname==="/api/admin/users"&&req.method==="GET")return adminUsers(env,c.sub,u.searchParams.get("q")||"");
    if(u.pathname==="/api/admin/wallet/adjust"&&req.method==="POST")return adminAdjustWallet(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/signup-bonus"&&req.method==="GET")return adminSignupBonus(env,c.sub);
    if(u.pathname==="/api/admin/signup-bonus"&&req.method==="POST")return updateAdminSignupBonus(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/islands"&&req.method==="GET")return adminIslandConfig(env,c.sub);
    if(u.pathname==="/api/admin/islands"&&req.method==="POST")return updateAdminIslandConfig(env,c.sub,await body(req));
    if(u.pathname==="/api/admin/withdrawals"&&req.method==="GET")return adminWithdrawals(env,c.sub);
    if(u.pathname==="/api/admin/withdrawals/review"&&req.method==="POST")return reviewWithdrawal(env,c.sub,await body(req));
    return json({success:false,error:"Route not found"},404);
  }catch(e){console.error(e);return json({success:false,error:"Game request failed"},500);}
}};
