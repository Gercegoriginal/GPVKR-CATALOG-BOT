import { TEXTS, esc } from './shared.js';

export async function initTables(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_texts (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_text_edit (user_id TEXT PRIMARY KEY, text_key TEXT NOT NULL)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_game_add (user_id TEXT PRIMARY KEY, step TEXT NOT NULL, title TEXT)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_admins (user_id TEXT PRIMARY KEY)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_search_limits (user_id TEXT PRIMARY KEY, last_search INTEGER NOT NULL)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS bot_ignored_posts (post_id INTEGER PRIMARY KEY)').run();
 await env.DB.prepare(`
  CREATE TABLE IF NOT EXISTS genres (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   name TEXT NOT NULL UNIQUE,
   slug TEXT NOT NULL UNIQUE
  )
 `).run();

 await env.DB.prepare(`
  CREATE TABLE IF NOT EXISTS game_genres (
   game_id INTEGER NOT NULL,
   genre_id INTEGER NOT NULL,
   PRIMARY KEY (game_id, genre_id),
   FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
   FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
  )
 `).run();

 await env.DB.prepare(
  'CREATE INDEX IF NOT EXISTS idx_game_genres_genre ON game_genres(genre_id, game_id)'
 ).run();
await env.DB.prepare(`
 CREATE TABLE IF NOT EXISTS pending_genres (
  post_id INTEGER PRIMARY KEY,
  slugs TEXT NOT NULL
 )
`).run();
}
export async function getText(env,key,vars={}){
 const def=TEXTS[key]?.value ?? key;
 const row=await env.DB.prepare('SELECT value FROM bot_texts WHERE key=?').bind(key).first();
 let value=row?.value ?? def;
 for(const [k,v] of Object.entries(vars)) value=value.replaceAll(`{${k}}`,esc(v));
 return value;
}
export async function saveText(env,key,value){await env.DB.prepare('INSERT INTO bot_texts(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();}
export async function resetText(env,key){await env.DB.prepare('DELETE FROM bot_texts WHERE key=?').bind(key).run();}
