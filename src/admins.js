import { api, esc, send } from './shared.js';
import { getText } from './db.js';

export function owner(userId,env){return !!String(env.ADMIN_ID??'').trim()&&String(userId).trim()===String(env.ADMIN_ID).trim();}
export async function textAdmin(userId,env){
 if(owner(userId,env))return true;
 const id=String(userId).trim();
 const row=await env.DB.prepare('SELECT user_id FROM bot_admins WHERE TRIM(user_id)=?').bind(id).first();
 return !!row;
}
export async function adminList(env,chat){
 const r=await env.DB.prepare('SELECT user_id FROM bot_admins ORDER BY user_id').all();
 const other=r.results.map(x=>'• <code>'+esc(x.user_id)+'</code>').join('\n')||await getText(env,'admin_none');
 const template=await getText(env,'admin_list',{owner:env.ADMIN_ID||'не задан'});
 return send(env,chat,template.replaceAll('{admins}',other));
}
export async function telegramOk(env,method,payload){
 try{const response=await api(env,method,payload);const result=await response.json();if(!result.ok)console.error(method,result.description);return !!result.ok;}
 catch(e){console.error(method,e);return false;}
}
const PUBLIC_COMMANDS=[{command:'start',description:'Открыть каталог'},{command:'menu',description:'Главное меню'},{command:'help',description:'Список команд'},{command:'count',description:'Количество игр'},{command:'whoami',description:'Мой Telegram ID'}];
const STAFF_COMMANDS=[...PUBLIC_COMMANDS,{command:'addgame',description:'Добавить игру вручную'},{command:'canceladdgame',description:'Отменить добавление игры'},{command:'setupcommands',description:'Обновить моё меню команд'},{command:'delgame',description:'Удалить пост из каталога'}];
const OWNER_COMMANDS=[...STAFF_COMMANDS,{command:'admins',description:'Список администраторов'},{command:'addadmin',description:'Добавить администратора'},{command:'deladmin',description:'Удалить администратора'},{command:'cooldown',description:'Интервал поиска'},{command:'texts',description:'Настроить тексты бота'},{command:'canceltext',description:'Отменить редактирование'},{command:'textstatus',description:'Проверить изменённые тексты'},{command:'resettexts',description:'Сбросить все тексты'}];
export async function setCommands(env,scope,commands){const response=await api(env,'setMyCommands',{scope,commands,language_code:'ru'});const data=await response.json();if(!data.ok)throw new Error('setMyCommands: '+JSON.stringify(data));}
export async function syncCommands(env,userId){
 const isOwner=owner(userId,env);
 const scope={type:'chat',chat_id:Number(userId)};
 const commands=isOwner?OWNER_COMMANDS:STAFF_COMMANDS;
 const response=await api(env,'getMyCommands',{scope,language_code:'ru'});
 const data=await response.json();
 if(!data.ok||!Array.isArray(data.result))throw new Error(data.description||'Не удалось получить меню Telegram');
 const current=data.result.map(x=>({command:x.command,description:x.description}));
 let changed=0,unchanged=0,errors=[];
 if(JSON.stringify(current)===JSON.stringify(commands))unchanged++;
 else {
  const update=await api(env,'setMyCommands',{scope,commands,language_code:'ru'});
  const result=await update.json();
  if(!result.ok)throw new Error(result.description||'Не удалось установить меню Telegram');
  changed++;
 }
 // Обновляем только меню пользователя, который сам вызвал /setupcommands.
 // Каждый администратор может обновить своё меню самостоятельно; меню других пользователей не трогаем.
 return {changed,unchanged,errors};
}
export async function helpText(env,userId){
 let t=await getText(env,'help_public');
 if(await textAdmin(userId,env))t+='\n\n'+await getText(env,'help_staff');
 if(owner(userId,env))t+='\n\n'+await getText(env,'help_owner');
 return t;
}
