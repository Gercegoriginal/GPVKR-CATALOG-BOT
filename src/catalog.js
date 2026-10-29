import { CHANNEL, esc, api, btn, link, send, edit } from './shared.js';
import { getText } from './db.js';
import {
  shouldSkipPost,
  genreSlugsFromPost,
  attachGenresToGame
} from './genres.js';

export async function getMenu(env){return [[btn(await getText(env,'btn_letters'),'letters')],[btn(await getText(env,'btn_help'),'help')],[link(await getText(env,'btn_channel'),`https://t.me/${CHANNEL}`)]];}
const validTitle=s=>s&&s.length>=2&&s.length<=90&&!/^(https?:|@|#|подпис|донат|сбор|опрос|новост|добива|внимани|привет|важн|объявлен|комментар|софт)/i.test(s);
export function guess(post){const text=(post.text||post.caption||'').trim();if(!text)return null;let title=text.split('\n').map(x=>x.trim()).find(Boolean)||'';title=title.replace(/^[🎮🕹️🔥⭐️•\-\s]+/u,'').replace(/\s*[|—–]\s*(скачать|android|андроид).*$/i,'').trim();const low=text.toLowerCase();const signals=/#(экшн|экшен|рпг|шутер|хоррор|приключения|инди|метроидвания|новелла|гонки|стратегия|симулятор|платформер|аркада|игры)|\b(apk|кэш|порт|мод|android|скачать)\b/i.test(low);return validTitle(title)?{title,signals}:null;}
export async function list(env,chat,msg,letter,page=0){const per=8;const where=letter?'WHERE upper(substr(title,1,1)) = ?':'';const args=letter?[letter]:[];const count=await env.DB.prepare(`SELECT count(*) n FROM games ${where}`).bind(...args).first();const total=count?.n||0;const pages=Math.max(1,Math.ceil(total/per));page=Math.max(0,Math.min(page,pages-1));const data=await env.DB.prepare(`SELECT title,url FROM games ${where} ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...args,per,page*per).all();const rows=data.results.map(g=>[link(g.title.slice(0,60),g.url)]);const nav=[];if(page>0)nav.push(btn(await getText(env,'btn_prev'),`p:${letter||'*'}:${page-1}`));nav.push(btn(await getText(env,'edit_page',{page:page+1,pages}),'noop'));if(page+1<pages)nav.push(btn(await getText(env,'btn_next'),`p:${letter||'*'}:${page+1}`));rows.push(nav);rows.push([btn(await getText(env,'btn_back_letters'),'letters'),btn(await getText(env,'btn_home'),'home')]);const title=letter?await getText(env,'list_letter_title',{letter}):await getText(env,'list_all_title');const body=await getText(env,'list_header',{title,total});return msg?edit(env,chat,msg,body,rows):send(env,chat,body,rows);}
export async function letters(env,chat,msg){const r=await env.DB.prepare('SELECT DISTINCT upper(substr(title,1,1)) letter FROM games ORDER BY letter').all();const arr=r.results.map(x=>x.letter).filter(x=>x&&x.length===1);const rows=[];for(let i=0;i<arr.length;i+=5)rows.push(arr.slice(i,i+5).map(c=>btn(c,`p:${c}:0`)));rows.push([btn(await getText(env,'btn_all_games'),'p:*:0')],[btn(await getText(env,'btn_home'),'home')]);const body=await getText(env,'letters_prompt');return msg?edit(env,chat,msg,body,rows):send(env,chat,body,rows);}
export async function search(env,chat,term,userId){
 const setting=await env.DB.prepare("SELECT value FROM bot_settings WHERE key='search_cooldown'").first();
 const cooldown=Math.max(0,Math.min(3600,Number(setting?.value??10)||0));
 if(cooldown>0){
  const now=Math.floor(Date.now()/1000);
  const result=await env.DB.prepare('INSERT INTO bot_search_limits(user_id,last_search) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_search=excluded.last_search WHERE bot_search_limits.last_search <= ?').bind(String(userId),now,now-cooldown).run();
  if(result.meta?.changes===0){
   const previous=await env.DB.prepare('SELECT last_search FROM bot_search_limits WHERE user_id=?').bind(String(userId)).first();
   const remaining=Math.max(1,cooldown-(now-Number(previous?.last_search||now)));
   return send(env,chat,await getText(env,'cooldown_wait',{seconds:remaining}));
  }
 }
 term=term.trim().slice(0,80);
 const r=await env.DB.prepare('SELECT title,url FROM games WHERE title LIKE ? ORDER BY title COLLATE NOCASE LIMIT 20').bind(`%${term}%`).all();
 const rows=r.results.map(g=>[link(g.title.slice(0,60),g.url)]);
 rows.push([btn(await getText(env,'btn_home'),'home')]);
 const body=r.results.length?await getText(env,'search_results',{term}):await getText(env,'search_empty',{term});
 return send(env,chat,body,rows);
}
export function csvParse(text){text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;}
export async function importCsv(env,msg){const f=msg.document;if(!f||!String(f.file_name||'').toLowerCase().endsWith('.csv'))return send(env,msg.chat.id,await getText(env,'import_wrong_file'));const r=await (await api(env,'getFile',{file_id:f.file_id})).json();if(!r.ok)return send(env,msg.chat.id,await getText(env,'import_getfile_error'));const resp=await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${r.result.file_path}`);if(!resp.ok)return send(env,msg.chat.id,await getText(env,'import_download_error'));const rows=csvParse(await resp.text());let added=0,skipped=0;for(const row of rows.slice(1,1000)){const title=(row[0]||'').trim(),url=(row[1]||'').trim();const m=url.match(/^https:\/\/t\.me\/gpvkr\/(\d+)$/);if(!title||!m){skipped++;continue;}await env.DB.prepare('INSERT OR IGNORE INTO games(title,url,post_id) VALUES(?,?,?)').bind(title,url,Number(m[1])).run();added++;}return send(env,msg.chat.id,await getText(env,'import_done',{added,skipped}));}
export async function channelPost(env,post,edited=false){if(post.chat?.username?.toLowerCase()!==CHANNEL)return;const id=post.message_id;const ignored=await env.DB.prepare('SELECT post_id FROM bot_ignored_posts WHERE post_id=?').bind(id).first();if(ignored)return;const count=await env.DB.prepare('SELECT count(*) n FROM games WHERE post_id=?').bind(id).first();if(count?.n)return;const item=guess(post);if(!item)return;const url=`https://t.me/${CHANNEL}/${id}`;if(item.signals){await env.DB.prepare('INSERT OR IGNORE INTO games(title,url,post_id) VALUES(?,?,?)').bind(item.title,url,id).run();if(env.ADMIN_ID)await send(env,env.ADMIN_ID,await getText(env,'auto_added',{title:item.title,url}));}else if(env.ADMIN_ID){const keyboard=[[btn(await getText(env,'btn_add'),`a:${id}`),btn(await getText(env,'btn_skip'),`x:${id}`)]];await send(env,env.ADMIN_ID,await getText(env,'pending_review',{title:item.title,url}),keyboard);await env.DB.prepare('INSERT OR REPLACE INTO pending(post_id,title) VALUES(?,?)').bind(id,item.title).run();}}
