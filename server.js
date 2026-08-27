require('dotenv').config();
const express=require('express'),http=require('http'),helmet=require('helmet'),crypto=require('crypto'),bcrypt=require('bcryptjs'),
multer=require('multer'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws'),{query}=require('./db');
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server,path:'/ws',maxPayload:65536});
app.use(helmet({crossOriginEmbedderPolicy:false}));app.use(express.json({limit:'64kb'}));app.use(express.static('public'));
const MEDIA_DIR=path.resolve(process.env.MEDIA_DIR||'./storage');
fs.mkdirSync(MEDIA_DIR,{recursive:true});
const MAX_UPLOAD_MB=Math.max(1,Math.min(25,Number(process.env.MAX_UPLOAD_MB||10)));
const upload=multer({
 storage:multer.diskStorage({
  destination:(_,__,cb)=>cb(null,MEDIA_DIR),
  filename:(_,file,cb)=>cb(null,crypto.randomBytes(24).toString('hex')+path.extname(file.originalname).toLowerCase().slice(0,10))
 }),
 limits:{fileSize:MAX_UPLOAD_MB*1024*1024,files:5},
 fileFilter:(_,file,cb)=>{
  const ok=/^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain|audio\/(mpeg|wav|ogg|webm)|video\/mp4)$/.test(file.mimetype);
  cb(ok?null:new Error('Unsupported file type'),ok)
 }
});
const ORIGINS=(process.env.CHATZAB_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean),rooms=new Map(),RATE=new Map();
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function cookie(req,n){const m=(req.headers.cookie||'').match(new RegExp('(?:^|; )'+n+'=([^;]+)'));return m?decodeURIComponent(m[1]):null}
function setCookie(res,v,maxAge){res.setHeader('Set-Cookie',`chatzab_session=${encodeURIComponent(v)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`)}
async function auth(req,res,next){try{const raw=cookie(req,'chatzab_session')||(req.headers.authorization||'').replace(/^Bearer /,'');if(!raw)return res.status(401).json({error:'Authentication required'});const r=await query(`SELECT u.id,u.username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[sha(raw)]);if(!r.rowCount)return res.status(401).json({error:'Session expired'});req.user=r.rows[0];next()}catch(e){next(e)}}
function rate(key,limit=30,windowMs=60000){const now=Date.now(),a=(RATE.get(key)||[]).filter(t=>now-t<windowMs);if(a.length>=limit)return false;a.push(now);RATE.set(key,a);return true}

app.get('/health',async(_,res)=>{try{await query('SELECT 1');res.json({ok:true,release:'1.7.0-beta.1'})}catch{res.status(503).json({ok:false})}});
app.post('/api/auth/register',async(req,res,next)=>{try{if(!rate('reg:'+req.ip,5,60000))return res.status(429).json({error:'Too many attempts'});let {username,displayName,email,password}=req.body||{};username=String(username||'').trim().toLowerCase();displayName=String(displayName||username).trim();email=email?String(email).trim().toLowerCase():null;if(!/^[a-z0-9_]{3,32}$/.test(username)||password?.length<8)return res.status(400).json({error:'Invalid username or password'});const ph=await bcrypt.hash(password,12);const u=await query('INSERT INTO users(username,display_name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,username,display_name,email',[username,displayName.slice(0,80),email,ph]);const token=crypto.randomBytes(32).toString('base64url'),days=Number(process.env.SESSION_DAYS||30);await query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+($3||\' days\')::interval)',[u.rows[0].id,sha(token),String(days)]);setCookie(res,token,days*86400);res.status(201).json({user:u.rows[0]})}catch(e){if(e.code==='23505')return res.status(409).json({error:'Username or email already exists'});next(e)}});
app.post('/api/auth/login',async(req,res,next)=>{try{if(!rate('login:'+req.ip,10,60000))return res.status(429).json({error:'Too many attempts'});const id=String(req.body.username||'').trim().toLowerCase(),r=await query('SELECT * FROM users WHERE username=$1 OR email=$1',[id]);if(!r.rowCount||!(await bcrypt.compare(String(req.body.password||''),r.rows[0].password_hash)))return res.status(401).json({error:'Invalid credentials'});const token=crypto.randomBytes(32).toString('base64url'),days=Number(process.env.SESSION_DAYS||30);await query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+($3||\' days\')::interval)',[r.rows[0].id,sha(token),String(days)]);setCookie(res,token,days*86400);res.json({user:{id:r.rows[0].id,username:r.rows[0].username,display_name:r.rows[0].display_name}})}catch(e){next(e)}});
app.post('/api/auth/logout',auth,async(req,res,next)=>{try{const raw=cookie(req,'chatzab_session');if(raw)await query('DELETE FROM sessions WHERE token_hash=$1',[sha(raw)]);res.setHeader('Set-Cookie','chatzab_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');res.json({ok:true})}catch(e){next(e)}});

app.get('/api/users/search',auth,async(req,res,next)=>{try{const q=String(req.query.q||'').trim().slice(0,32);if(q.length<2)return res.json({users:[]});const r=await query(`SELECT id,username,display_name FROM users WHERE (username ILIKE $1 OR display_name ILIKE $1) AND id<>$2 ORDER BY username LIMIT 20`,['%'+q+'%',req.user.id]);res.json({users:r.rows})}catch(e){next(e)}});
app.post('/api/users/:id/block',auth,async(req,res,next)=>{try{const id=Number(req.params.id);if(id===req.user.id)return res.status(400).json({error:'Cannot block yourself'});await query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,id]);res.json({ok:true})}catch(e){next(e)}});
app.post('/api/conversations/:id/messages-with-files',auth,(req,res,next)=>{
 upload.array('files',5)(req,res,async err=>{
  if(err)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'File is too large':err.message});
  try{
   const cid=Number(req.params.id),body=String(req.body.body||'').trim().slice(0,4000);
   const member=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[cid,req.user.id]);
   if(!member.rowCount){for(const f of (req.files||[]))try{fs.unlinkSync(f.path)}catch{};return res.status(403).json({error:'Not a member'})}
   if(!body && !(req.files||[]).length)return res.status(400).json({error:'Message or attachment required'});
   const m=await query('INSERT INTO messages(conversation_id,sender_id,body) VALUES($1,$2,$3) RETURNING *',[cid,req.user.id,body||'']);
   const attachments=[];
   for(const f of (req.files||[])){
    const kind=f.mimetype.startsWith('image/')?'image':f.mimetype.startsWith('audio/')?'audio':'file';
    const u=await query('INSERT INTO media_uploads(uploader_id,original_name,mime_type,size_bytes,storage_key) VALUES($1,$2,$3,$4,$5) RETURNING id',[req.user.id,f.originalname,f.mimetype,f.size,path.basename(f.path)]);
    const a=await query(`INSERT INTO message_attachments(message_id,kind,original_name,mime_type,size_bytes,storage_key,upload_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,kind,original_name,mime_type,size_bytes,storage_key`,[m.rows[0].id,kind,f.originalname,f.mimetype,f.size,path.basename(f.path),u.rows[0].id]);
    attachments.push(a.rows[0]);
   }
   const message={...m.rows[0],attachments,reactions:[]};
   broadcast(cid,{type:'message',message});res.status(201).json({message});
  }catch(e){for(const f of (req.files||[]))try{fs.unlinkSync(f.path)}catch{};next(e)}
 });
});

app.get('/api/media/:key',auth,async(req,res,next)=>{
 try{
  const key=path.basename(req.params.key);
  const r=await query(`SELECT a.original_name,a.mime_type,a.size_bytes
    FROM message_attachments a WHERE a.storage_key=$1
    AND EXISTS(SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
               WHERE m.id=a.message_id AND cm.user_id=$2)`,[key,req.user.id]);
  if(!r.rowCount)return res.status(404).json({error:'Media not found'});
  const file=path.join(MEDIA_DIR,key);if(!fs.existsSync(file))return res.status(404).json({error:'Media unavailable'});
  res.setHeader('Content-Type',r.rows[0].mime_type);
  res.setHeader('Content-Length',r.rows[0].size_bytes);
  res.setHeader('Content-Disposition',`inline; filename="${r.rows[0].original_name.replace(/["\\]/g,'')}"`);
  res.sendFile(file);
 }catch(e){next(e)}
});

app.post('/api/conversations/direct',auth,async(req,res,next)=>{try{const other=Number(req.body.userId);if(!other||other===req.user.id)return res.status(400).json({error:'Invalid user'});const blocked=await query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[req.user.id,other]);if(blocked.rowCount)return res.status(403).json({error:'Conversation unavailable'});const found=await query(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=$1 JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=$2 WHERE c.kind='direct' LIMIT 1`,[req.user.id,other]);if(found.rowCount)return res.json({conversationId:found.rows[0].id});const c=await query(`INSERT INTO conversations(kind) VALUES('direct') RETURNING id`,[]),id=c.rows[0].id;await query('INSERT INTO conversation_members(conversation_id,user_id) VALUES($1,$2),($1,$3)',[id,req.user.id,other]);res.status(201).json({conversationId:id})}catch(e){next(e)}});
app.get('/api/conversations',auth,async(req,res,next)=>{try{const r=await query(`SELECT c.id,c.kind,c.title,c.created_at,COUNT(m.id)::int AS message_count FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id LEFT JOIN messages m ON m.conversation_id=c.id WHERE cm.user_id=$1 GROUP BY c.id ORDER BY c.id DESC`,[req.user.id]);res.json({conversations:r.rows})}catch(e){next(e)}});
app.get('/api/messages/:id',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id);
 const r=await query(`SELECT m.*,u.username,u.display_name,
 COALESCE(json_agg(DISTINCT jsonb_build_object('id',a.id,'kind',a.kind,'name',a.original_name,'mimeType',a.mime_type,'size',a.size_bytes,'storageKey',a.storage_key)) FILTER(WHERE a.id IS NOT NULL),'[]') attachments,
 COALESCE(json_agg(DISTINCT jsonb_build_object('userId',mr.user_id,'emoji',mr.emoji)) FILTER(WHERE mr.user_id IS NOT NULL),'[]') reactions
 FROM messages m JOIN users u ON u.id=m.sender_id
 LEFT JOIN message_attachments a ON a.message_id=m.id
 LEFT JOIN message_reactions mr ON mr.message_id=m.id
 WHERE m.id=$1 GROUP BY m.id,u.id`,[id]);
 if(!r.rowCount)return res.status(404).json({error:'Message not found'});
 const member=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[r.rows[0].conversation_id,req.user.id]);
 if(!member.rowCount)return res.status(403).json({error:'Not a member'});
 res.json({message:r.rows[0]})
}catch(e){next(e)}});

app.get('/api/conversations/:id/messages',auth,async(req,res,next)=>{try{const id=Number(req.params.id),ok=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[id,req.user.id]);if(!ok.rowCount)return res.status(403).json({error:'Not a member'});const r=await query(`SELECT m.id,m.conversation_id,m.sender_id,m.body,m.created_at,m.edited_at,m.deleted_at,m.pinned,
 COALESCE(json_agg(DISTINCT jsonb_build_object('id',a.id,'kind',a.kind,'name',a.original_name,'mimeType',a.mime_type,'size',a.size_bytes,'storageKey',a.storage_key)) FILTER(WHERE a.id IS NOT NULL),'[]') attachments,
 COALESCE(json_agg(DISTINCT jsonb_build_object('userId',mr.user_id,'emoji',mr.emoji)) FILTER(WHERE mr.user_id IS NOT NULL),'[]') reactions,
 MAX(mr2.replied_to_message_id) AS replied_to_message_id
 FROM messages m
 LEFT JOIN message_attachments a ON a.message_id=m.id
 LEFT JOIN message_reactions mr ON mr.message_id=m.id
 LEFT JOIN message_replies mr2 ON mr2.message_id=m.id
 WHERE m.conversation_id=$1 GROUP BY m.id ORDER BY m.id DESC LIMIT 100`,[id]);res.json({messages:r.rows.reverse()})}catch(e){next(e)}});
app.post('/api/conversations/:id/messages',auth,async(req,res,next)=>{try{const id=Number(req.params.id),body=String(req.body.body||'').trim().slice(0,4000);if(!body)return res.status(400).json({error:'Message is empty'});const ok=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[id,req.user.id]);if(!ok.rowCount)return res.status(403).json({error:'Not a member'});const b=await query(`SELECT 1 FROM blocks b JOIN conversation_members cm ON cm.user_id=b.blocked_id WHERE b.blocker_id=$1 AND cm.conversation_id=$2`,[req.user.id,id]);if(b.rowCount)return res.status(403).json({error:'Conversation unavailable'});const r=await query('INSERT INTO messages(conversation_id,sender_id,body) VALUES($1,$2,$3) RETURNING *',[id,req.user.id,body]);broadcast(id,{type:'message',message:r.rows[0]});const members=await query('SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id<>$2',[id,req.user.id]);for(const m of members.rows)await query(`INSERT INTO notifications(user_id,type,title,body,conversation_id,message_id) VALUES($1,'message',$2,$3,$4,$5)`,[m.user_id,req.user.display_name,body.slice(0,500),id,r.rows[0].id]);res.status(201).json({message:r.rows[0]})}catch(e){next(e)}});
app.post('/api/conversations/:id/read',auth,async(req,res,next)=>{try{const id=Number(req.params.id),mid=Number(req.body.messageId)||0;const ok=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[id,req.user.id]);if(!ok.rowCount)return res.status(403).json({error:'Not a member'});await query(`INSERT INTO conversation_reads(conversation_id,user_id,last_read_message_id) VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_message_id=GREATEST(conversation_reads.last_read_message_id,EXCLUDED.last_read_message_id),updated_at=now()`,[id,req.user.id,mid]);res.json({ok:true})}catch(e){next(e)}});
app.post('/api/messages/:id/reactions',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),emoji=String(req.body.emoji||'').trim().slice(0,32);
 if(!emoji)return res.status(400).json({error:'Emoji required'});
 const m=await query('SELECT conversation_id FROM messages WHERE id=$1',[id]);if(!m.rowCount)return res.status(404).json({error:'Message not found'});
 const member=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[m.rows[0].conversation_id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:'Not a member'});
 await query('INSERT INTO message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,req.user.id,emoji]);
 broadcast(m.rows[0].conversation_id,{type:'reaction',messageId:id,userId:req.user.id,emoji});res.status(201).json({ok:true})
}catch(e){next(e)}});

app.delete('/api/messages/:id/reactions/:emoji',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),emoji=String(req.params.emoji).slice(0,32);
 await query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',[id,req.user.id,emoji]);
 const m=await query('SELECT conversation_id FROM messages WHERE id=$1',[id]);if(m.rowCount)broadcast(m.rows[0].conversation_id,{type:'reaction_removed',messageId:id,userId:req.user.id,emoji});
 res.json({ok:true})
}catch(e){next(e)}});

app.post('/api/messages/:id/reply',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),to=Number(req.body.repliedToMessageId);
 const r=await query('SELECT conversation_id FROM messages WHERE id=$1',[id]),q=await query('SELECT conversation_id FROM messages WHERE id=$1',[to]);
 if(!r.rowCount||!q.rowCount||r.rows[0].conversation_id!==q.rows[0].conversation_id)return res.status(400).json({error:'Invalid reply'});
 const member=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[r.rows[0].conversation_id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:'Not a member'});
 await query('INSERT INTO message_replies(message_id,replied_to_message_id) VALUES($1,$2) ON CONFLICT(message_id) DO UPDATE SET replied_to_message_id=EXCLUDED.replied_to_message_id',[id,to]);
 broadcast(r.rows[0].conversation_id,{type:'reply',messageId:id,repliedToMessageId:to});res.json({ok:true})
}catch(e){next(e)}});

app.patch('/api/messages/:id',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),body=String(req.body.body||'').trim().slice(0,4000);
 const r=await query('SELECT conversation_id,sender_id,created_at FROM messages WHERE id=$1',[id]);if(!r.rowCount)return res.status(404).json({error:'Message not found'});
 if(r.rows[0].sender_id!==req.user.id)return res.status(403).json({error:'Only the sender can edit'});
 if(Date.now()-new Date(r.rows[0].created_at).getTime()>15*60*1000)return res.status(400).json({error:'Edit window expired'});
 await query('UPDATE messages SET body=$1,edited_at=now() WHERE id=$2',[body,id]);
 broadcast(r.rows[0].conversation_id,{type:'message_edited',messageId:id,body,editedAt:new Date().toISOString()});res.json({ok:true})
}catch(e){next(e)}});

app.delete('/api/messages/:id',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),r=await query('SELECT conversation_id,sender_id FROM messages WHERE id=$1',[id]);if(!r.rowCount)return res.status(404).json({error:'Message not found'});
 if(r.rows[0].sender_id!==req.user.id)return res.status(403).json({error:'Only the sender can delete'});
 await query('UPDATE messages SET deleted_at=now(),body=$1 WHERE id=$2',['Message deleted',id]);
 broadcast(r.rows[0].conversation_id,{type:'message_deleted',messageId:id});res.json({ok:true})
}catch(e){next(e)}});

app.post('/api/messages/:id/pin',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),r=await query('SELECT conversation_id FROM messages WHERE id=$1',[id]);if(!r.rowCount)return res.status(404).json({error:'Message not found'});
 const member=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[r.rows[0].conversation_id,req.user.id]);if(!member.rowCount)return res.status(403).json({error:'Not a member'});
 const pinned=req.body.pinned!==false;await query('UPDATE messages SET pinned=$1 WHERE id=$2',[pinned,id]);
 broadcast(r.rows[0].conversation_id,{type:'message_pinned',messageId:id,pinned});res.json({ok:true,pinned})
}catch(e){next(e)}});

/* Groups & Communities */
app.post('/api/groups',auth,async(req,res,next)=>{try{
 const title=String(req.body.title||'').trim().slice(0,100);if(!title)return res.status(400).json({error:'Group name required'});
 const c=await query("INSERT INTO conversations(kind,title) VALUES('group',$1) RETURNING id,title,created_at",[title]);
 const id=c.rows[0].id;await query('INSERT INTO conversation_members(conversation_id,user_id,role) VALUES($1,$2,$3)',[id,req.user.id,'owner']);
 await query('INSERT INTO group_roles(conversation_id,user_id,role) VALUES($1,$2,$3)',[id,req.user.id,'owner']);
 await query('INSERT INTO conversation_settings(conversation_id,description,invite_code) VALUES($1,$2,$3)',[id,String(req.body.description||'').slice(0,500),crypto.randomBytes(12).toString('base64url')]);
 res.status(201).json({group:c.rows[0]});
}catch(e){next(e)}});

app.post('/api/groups/:id/members',auth,async(req,res,next)=>{try{
 const cid=Number(req.params.id),uid=Number(req.body.userId);
 const admin=await query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND role IN('owner','admin')",[cid,req.user.id]);
 if(!admin.rowCount)return res.status(403).json({error:'Admin permission required'});
 const exists=await query('SELECT 1 FROM users WHERE id=$1',[uid]);if(!exists.rowCount)return res.status(404).json({error:'User not found'});
 await query('INSERT INTO conversation_members(conversation_id,user_id,role) VALUES($1,$2,\\'member\\') ON CONFLICT DO NOTHING',[cid,uid]);
 await query('INSERT INTO group_roles(conversation_id,user_id,role) VALUES($1,$2,\\'member\\') ON CONFLICT DO NOTHING',[cid,uid]);
 res.status(201).json({ok:true});
}catch(e){next(e)}});

app.delete('/api/groups/:id/members/:userId',auth,async(req,res,next)=>{try{
 const cid=Number(req.params.id),uid=Number(req.params.userId);
 const admin=await query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND role IN('owner','admin')",[cid,req.user.id]);
 if(!admin.rowCount)return res.status(403).json({error:'Admin permission required'});
 if(uid===req.user.id)return res.status(400).json({error:'Use leave endpoint for yourself'});
 await query("DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND role<>'owner'",[cid,uid]);
 await query('DELETE FROM group_roles WHERE conversation_id=$1 AND user_id=$2',[cid,uid]);
 res.json({ok:true});
}catch(e){next(e)}});

app.patch('/api/groups/:id/members/:userId/role',auth,async(req,res,next)=>{try{
 const cid=Number(req.params.id),uid=Number(req.params.userId),role=String(req.body.role||'member');
 if(!['admin','member'].includes(role))return res.status(400).json({error:'Invalid role'});
 const owner=await query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND role='owner'",[cid,req.user.id]);
 if(!owner.rowCount)return res.status(403).json({error:'Owner permission required'});
 await query("UPDATE conversation_members SET role=$1 WHERE conversation_id=$2 AND user_id=$3 AND role<>'owner'",[role,cid,uid]);
 await query("UPDATE group_roles SET role=$1 WHERE conversation_id=$2 AND user_id=$3 AND role<>'owner'",[role,cid,uid]);
 res.json({ok:true,role});
}catch(e){next(e)}});

app.get('/api/groups/:id/members',auth,async(req,res,next)=>{try{
 const cid=Number(req.params.id),ok=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[cid,req.user.id]);
 if(!ok.rowCount)return res.status(403).json({error:'Not a member'});
 const r=await query(`SELECT u.id,u.username,u.display_name,cm.role FROM conversation_members cm JOIN users u ON u.id=cm.user_id WHERE cm.conversation_id=$1 ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.username`,[cid]);
 res.json({members:r.rows});
}catch(e){next(e)}});

app.patch('/api/groups/:id',auth,async(req,res,next)=>{try{
 const cid=Number(req.params.id),title=String(req.body.title||'').trim().slice(0,100),description=String(req.body.description||'').slice(0,500);
 const owner=await query("SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND role IN('owner','admin')",[cid,req.user.id]);
 if(!owner.rowCount)return res.status(403).json({error:'Admin permission required'});
 await query('UPDATE conversations SET title=$1 WHERE id=$2 AND kind=\\'group\\'',[title,cid]);
 await query('UPDATE conversation_settings SET description=$1 WHERE conversation_id=$2',[description,cid]);
 res.json({ok:true});
}catch(e){next(e)}});

app.post('/api/communities',auth,async(req,res,next)=>{try{
 const name=String(req.body.name||'').trim().slice(0,100),slug=String(req.body.slug||name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')).slice(0,50);
 if(!name||!slug)return res.status(400).json({error:'Community name and slug required'});
 const c=await query('INSERT INTO communities(slug,name,description,owner_id) VALUES($1,$2,$3,$4) RETURNING id,slug,name,description,owner_id',[slug,name,String(req.body.description||'').slice(0,500),req.user.id]);
 await query("INSERT INTO community_members(community_id,user_id,role) VALUES($1,$2,'owner')",[c.rows[0].id,req.user.id]);
 res.status(201).json({community:c.rows[0]});
}catch(e){if(e.code==='23505')return res.status(409).json({error:'Community slug already exists'});next(e)}});

app.get('/api/communities',auth,async(req,res,next)=>{try{
 const r=await query(`SELECT c.id,c.slug,c.name,c.description,c.owner_id,COUNT(cm.user_id)::int AS member_count
 FROM communities c LEFT JOIN community_members cm ON cm.community_id=c.id
 GROUP BY c.id ORDER BY c.id DESC LIMIT 50`);
 res.json({communities:r.rows});
}catch(e){next(e)}});

app.post('/api/communities/:id/join',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),r=await query('SELECT id,visibility FROM communities WHERE id=$1',[id]);if(!r.rowCount)return res.status(404).json({error:'Community not found'});
 if(r.rows[0].visibility!=='public')return res.status(403).json({error:'Invite required'});
 await query("INSERT INTO community_members(community_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[id,req.user.id]);
 res.json({ok:true});
}catch(e){next(e)}});

app.post('/api/communities/:id/channels',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),name=String(req.body.name||'').trim().slice(0,100),slug=String(req.body.slug||name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,50);
 const owner=await query("SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2 AND role IN('owner','admin')",[id,req.user.id]);
 if(!owner.rowCount)return res.status(403).json({error:'Admin permission required'});
 const r=await query("INSERT INTO channels(community_id,slug,name,kind,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",[id,slug,name,String(req.body.kind||'discussion'),req.user.id]);
 res.status(201).json({channel:r.rows[0]});
}catch(e){if(e.code==='23505')return res.status(409).json({error:'Channel slug already exists'});next(e)}});

app.get('/api/communities/:id/channels',auth,async(req,res,next)=>{try{
 const id=Number(req.params.id),member=await query('SELECT 1 FROM community_members WHERE community_id=$1 AND user_id=$2',[id,req.user.id]);
 if(!member.rowCount)return res.status(403).json({error:'Not a community member'});
 const r=await query('SELECT id,slug,name,kind,created_at FROM channels WHERE community_id=$1 ORDER BY id',[id]);res.json({channels:r.rows});
}catch(e){next(e)}});

app.get('/api/notifications',auth,async(req,res,next)=>{try{const r=await query('SELECT id,type,title,body,conversation_id,message_id,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 50',[req.user.id]);res.json({notifications:r.rows,unread:r.rows.filter(x=>!x.read_at).length})}catch(e){next(e)}});
app.post('/api/notifications/read',auth,async(req,res,next)=>{try{await query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);res.json({ok:true})}catch(e){next(e)}});

app.use((e,_,res,__)=>{console.error(e);res.status(500).json({error:'Internal server error'})});
function broadcast(cid,p){const s=rooms.get(String(cid));if(s)for(const ws of s)if(ws.readyState===1)ws.send(JSON.stringify(p))}
wss.on('connection',async(ws,req)=>{const origin=req.headers.origin||'';if(ORIGINS.length&&!ORIGINS.includes(origin))return ws.close(1008,'Origin rejected');const h=req.headers.authorization||'',raw=h.startsWith('Bearer ')?h.slice(7):null;if(!raw)return ws.close(1008,'Authentication required');const r=await query('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[sha(raw)]);if(!r.rowCount)return ws.close(1008,'Authentication required');ws.user=r.rows[0];ws.room=null;ws.alive=true;ws.on('pong',()=>ws.alive=true);ws.on('message',async rawmsg=>{let d;try{d=JSON.parse(rawmsg)}catch{return}if(d.type==='subscribe'){const cid=Number(d.conversationId),ok=await query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[cid,ws.user.id]);if(!ok.rowCount)return;ws.room=String(cid);if(!rooms.has(ws.room))rooms.set(ws.room,new Set());rooms.get(ws.room).add(ws);ws.send(JSON.stringify({type:'subscribed',conversationId:cid}))}else if(d.type==='typing'&&ws.room)broadcast(ws.room,{type:'typing',userId:ws.user.id,typing:!!d.typing})});ws.on('close',()=>{if(ws.room&&rooms.has(ws.room)){rooms.get(ws.room).delete(ws);if(!rooms.get(ws.room).size)rooms.delete(ws.room)}})});
setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue}ws.alive=false;ws.ping()}},30000);
server.listen(process.env.PORT||3000,()=>console.log('Chatzab 1.4.0-beta.1 running'));
