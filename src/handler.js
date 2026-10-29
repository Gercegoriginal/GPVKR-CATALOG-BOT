
import { CHANNEL, TEXTS, api, btn, link, send, edit, esc } from './shared.js';
import { initTables, getText, saveText, resetText } from './db.js';
import { channelPost, list, letters, search, importCsv, getMenu } from './catalog.js';
import { owner, textAdmin, adminList, telegramOk, syncCommands, helpText } from './admins.js';
import { showTextSettings } from './texts.js';
import {
  initGenres,
  showGenres,
  showGenreGames,
  attachGenresToGame
} from './genres.js';

export async function update(env, u) {
  await initTables(env);
  await initGenres(env);

  if (u.channel_post || u.edited_channel_post) {
    return channelPost(
      env,
      u.channel_post || u.edited_channel_post,
      !!u.edited_channel_post
    );
  }

  if (u.callback_query) {
    const c = u.callback_query;
    const chat = c.message?.chat?.id;
    const msg = c.message?.message_id;
    const d = c.data || '';

    await api(env, 'answerCallbackQuery', {
      callback_query_id: c.id
    });

    if (!chat || !msg) return;
    if (d === 'noop') return;

    if (
      (d === 'txclose' || d === 'txcancel' ||
       d.startsWith('txpage:') || d.startsWith('tx:') ||
       d.startsWith('tr:')) &&
      !owner(c.from.id, env)
    ) {
      return edit(env, chat, msg, await getText(env, 'admin_forbidden'), []);
    }

    if (d === 'rt:n' && owner(c.from.id, env)) {
      return edit(env, chat, msg, 'Сброс текстов отменён. Ничего не изменено.', []);
    }

    if (d === 'rt:y' && owner(c.from.id, env)) {
      await env.DB.prepare('DELETE FROM bot_texts').run();
      await env.DB.prepare('DELETE FROM bot_text_edit').run();

      return edit(
        env,
        chat,
        msg,
        '✅ Все изменённые тексты сброшены к исходным значениям. Активные состояния редактирования очищены.',
        []
      );
    }

    if (d === 'home') {
      return edit(env, chat, msg, await getText(env, 'welcome'), await getMenu(env));
    }

    if (d === 'letters') {
      return letters(env, chat, msg);
    }

    if (d === 'genres') {
      return showGenres(env, chat, msg);
    }

    if (d.startsWith('genre:')) {
      const parts = d.split(':');
      return showGenreGames(
        env,
        chat,
        msg,
        parts[1],
        Number(parts[2]) || 0
      );
    }

    if (d === 'help') {
      return edit(
        env,
        chat,
        msg,
        await helpText(env, c.from.id),
        [[btn(await getText(env, 'btn_home'), 'home')]]
      );
    }

    if (d.startsWith('dg:')) {
      if (!await textAdmin(c.from.id, env)) {
        return edit(env, chat, msg, await getText(env, 'setup_forbidden'), []);
      }

      const parts = d.split(':');
      const id = Number(parts[2]);

      if (!Number.isSafeInteger(id) || id < 1) {
        return edit(env, chat, msg, await getText(env, 'delgame_bad_id'), []);
      }

      if (parts[1] === 'n') {
        return edit(env, chat, msg, await getText(env, 'delgame_cancelled'), []);
      }

      if (parts[1] === 'y') {
        await env.DB.prepare(
          'DELETE FROM bot_text_edit WHERE user_id=?'
        ).bind(String(c.from.id)).run();

        await env.DB.prepare(
          'DELETE FROM bot_game_add WHERE user_id=?'
        ).bind(String(c.from.id)).run();

        const rows = await env.DB.prepare(
          'SELECT title FROM games WHERE post_id=?'
        ).bind(id).all();

        if (!rows.results.length) {
          return edit(env, chat, msg, await getText(env, 'delgame_not_found'), []);
        }

        await env.DB.prepare(
          'DELETE FROM games WHERE post_id=?'
        ).bind(id).run();

        await env.DB.prepare(
          'INSERT OR IGNORE INTO bot_ignored_posts(post_id) VALUES(?)'
        ).bind(id).run();

        await env.DB.prepare(
          'DELETE FROM pending WHERE post_id=?'
        ).bind(id).run();

        await env.DB.prepare(
          'DELETE FROM pending_genres WHERE post_id=?'
        ).bind(id).run();

        return edit(
          env,
          chat,
          msg,
          await getText(env, 'delgame_done') + '\n' +
            rows.results.map(x => '• ' + esc(x.title)).join('\n'),
          []
        );
      }

      return;
    }

    if (d.startsWith('p:')) {
      const parts = d.split(':');
      return list(
        env,
        chat,
        msg,
        parts[1] === '*' ? null : parts[1],
        Number(parts[2]) || 0
      );
    }

    if (d === 'txclose' && owner(c.from.id, env)) {
      return edit(env, chat, msg, await getText(env, 'edit_cancelled'), []);
    }

    if (d.startsWith('txpage:') && owner(c.from.id, env)) {
      return showTextSettings(env, chat, Number(d.slice(7)) || 0, msg);
    }

    if (d.startsWith('tx:') && owner(c.from.id, env)) {
      const key = d.slice(3);

      if (!TEXTS[key]) {
        return send(env, chat, await getText(env, 'edit_bad_key'));
      }

      await env.DB.prepare(
        'INSERT INTO bot_text_edit(user_id,text_key) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET text_key=excluded.text_key'
      ).bind(String(c.from.id), key).run();

      const row = await env.DB.prepare(
        'SELECT value FROM bot_texts WHERE key=?'
      ).bind(key).first();

      const current = row?.value ?? TEXTS[key].value;

      return send(
        env,
        chat,
        `<b>${esc(TEXTS[key].label)}</b>\n` +
          `${await getText(env, 'edit_current_text')}\n` +
          `<pre>${esc(current)}</pre>\n\n` +
          `${await getText(env, 'edit_prompt', { label: TEXTS[key].label })}`,
        [[btn(await getText(env, 'btn_cancel_edit'), 'txcancel')]]
      );
    }

    if (d === 'txcancel' && owner(c.from.id, env)) {
      await env.DB.prepare(
        'DELETE FROM bot_text_edit WHERE user_id=?'
      ).bind(String(c.from.id)).run();

      return send(env, chat, await getText(env, 'edit_cancelled'));
    }

    if (d.startsWith('tr:') && owner(c.from.id, env)) {
      const key = d.slice(3);

      if (!TEXTS[key]) {
        return send(env, chat, await getText(env, 'edit_bad_key'));
      }

      await resetText(env, key);
      return send(env, chat, `${await getText(env, 'edit_reset')}\n<b>${esc(TEXTS[key].label)}</b>`);
    }

    if (
      (d.startsWith('a:') || d.startsWith('x:')) &&
      await textAdmin(c.from.id, env)
    ) {
      const id = Number(d.slice(2));

      const p = await env.DB.prepare(
        'SELECT title FROM pending WHERE post_id=?'
      ).bind(id).first();

      if (p && d[0] === 'a') {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO games(title,url,post_id) VALUES(?,?,?)'
        ).bind(p.title, `https://t.me/${CHANNEL}/${id}`, id).run();

        const game = await env.DB.prepare(
          'SELECT id FROM games WHERE post_id=?'
        ).bind(id).first();

        const saved = await env.DB.prepare(
          'SELECT slugs FROM pending_genres WHERE post_id=?'
        ).bind(id).first();

        let slugs = [];

        try {
          slugs = saved ? JSON.parse(saved.slugs) : [];
        } catch {
          slugs = [];
        }

        await attachGenresToGame(env, game?.id, slugs);
      }

      await env.DB.prepare(
        'DELETE FROM pending WHERE post_id=?'
      ).bind(id).run();

      await env.DB.prepare(
        'DELETE FROM pending_genres WHERE post_id=?'
      ).bind(id).run();

      return edit(
        env,
        chat,
        msg,
        await getText(env, d[0] === 'a' ? 'review_added' : 'review_skipped'),
        []
      );
    }

    return;
  }

  const m = u.message;
  if (!m || m.chat?.type !== 'private') return;

  const chat = m.chat.id;
  const txt = (m.text || m.caption || '').trim();

  if (!owner(m.from.id, env)) {
    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).run();
  }

  if (owner(m.from.id, env) && txt === '/canceltext') {
    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    return send(env, chat, await getText(env, 'edit_cancelled'));
  }

  if (owner(m.from.id, env) && m.text && !txt.startsWith('/')) {
    const pending = await env.DB.prepare(
      'SELECT text_key FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).first();

    if (pending) {
      await saveText(env, pending.text_key, m.text);

      await env.DB.prepare(
        'DELETE FROM bot_text_edit WHERE user_id=?'
      ).bind(String(m.from.id)).run();

      return send(env, chat, await getText(env, 'edit_saved'));
    }
  }

  if (/^\/(admins|addadmin|deladmin)(?:\s|$)/.test(txt)) {
    if (!owner(m.from.id, env)) {
      return send(env, chat, await getText(env, 'admin_forbidden'));
    }

    if (txt === '/admins') return adminList(env, chat);

    const parts = txt.split(/\s+/);
    const id = parts[1];

    if (!/^\d{5,20}$/.test(id || '')) {
      return send(env, chat, await getText(env, 'admin_bad_id'));
    }

    if (owner(id, env)) {
      return send(env, chat, await getText(env, 'admin_owner_protected'));
    }

    if (parts[0] === '/addadmin') {
      const result = await env.DB.prepare(
        'INSERT OR IGNORE INTO bot_admins(user_id) VALUES(?)'
      ).bind(id).run();

      if (result.meta?.changes === 0) {
        return send(env, chat, await getText(env, 'admin_already', { id }));
      }

      await send(env, chat, await getText(env, 'admin_added', { id }));

      const notified = await telegramOk(env, 'sendMessage', {
        chat_id: Number(id),
        text: await getText(env, 'admin_welcome'),
        parse_mode: 'HTML'
      });

      await send(env, chat, await getText(env, notified ? 'admin_notify_ok' : 'admin_notify_failed'));

      const menuOk = await telegramOk(env, 'setMyCommands', {
        scope: { type: 'chat', chat_id: Number(id) },
        commands: STAFF_COMMANDS,
        language_code: 'ru'
      });

      if (!menuOk) {
        await send(env, chat, await getText(env, 'admin_menu_failed'));
      }

      return;
    }

    await env.DB.prepare(
      'DELETE FROM bot_admins WHERE user_id=?'
    ).bind(id).run();

    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(id).run();

    await telegramOk(env, 'deleteMyCommands', {
      scope: { type: 'chat', chat_id: Number(id) },
      language_code: 'ru'
    });

    await send(env, chat, await getText(env, 'admin_removed', { id }));

    const notified = await telegramOk(env, 'sendMessage', {
      chat_id: Number(id),
      text: await getText(env, 'admin_removed_notice'),
      parse_mode: 'HTML'
    });

    return send(
      env,
      chat,
      await getText(env, notified ? 'admin_removed_notify_ok' : 'admin_removed_notify_failed')
    );
  }

  if (/^\/canceladdgame(?:@\w+)?$/.test(txt)) {
    if (!await textAdmin(m.from.id, env)) {
      return send(env, chat, await getText(env, 'setup_forbidden'));
    }

    await env.DB.prepare(
      'DELETE FROM bot_game_add WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    return send(env, chat, 'Добавление игры отменено.');
  }

  if (/^\/addgame(?:@\w+)?(?:\s|$)/.test(txt)) {
    if (!await textAdmin(m.from.id, env)) {
      return send(env, chat, await getText(env, 'setup_forbidden'));
    }

    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    await env.DB.prepare(
      "INSERT INTO bot_game_add(user_id,step,title) VALUES(? ,'title',NULL) ON CONFLICT(user_id) DO UPDATE SET step='title',title=NULL"
    ).bind(String(m.from.id)).run();

    return send(
      env,
      chat,
      '➕ <b>Добавление игры вручную</b>\n\nОтправь название игры. Следующим сообщением пришлёшь ссылку на пост в канале @gpvkr.\nДля отмены: /canceladdgame'
    );
  }

  if (await textAdmin(m.from.id, env) && m.text && !txt.startsWith('/')) {
    const flow = await env.DB.prepare(
      'SELECT step,title FROM bot_game_add WHERE user_id=?'
    ).bind(String(m.from.id)).first();

    if (flow) {
      if (flow.step === 'title') {
        const title = m.text.trim();

        if (title.length < 2 || title.length > 150) {
          return send(
            env,
            chat,
            'Название должно быть длиной от 2 до 150 символов. Отправь название ещё раз или /canceladdgame.'
          );
        }

        await env.DB.prepare(
          "UPDATE bot_game_add SET step='url',title=? WHERE user_id=?"
        ).bind(title, String(m.from.id)).run();

        return send(
          env,
          chat,
          'Теперь отправь ссылку на пост в канале @gpvkr, например: https://t.me/gpvkr/123'
        );
      }

      if (flow.step === 'url') {
        const match = m.text.trim().match(/^(?:https?:\/\/)?t\.me\/gpvkr\/(\d+)\/?$/i);

        if (!match || Number(match[1]) < 1) {
          return send(
            env,
            chat,
            'Не распознал ссылку. Нужна ссылка вида https://t.me/gpvkr/123. Попробуй ещё раз или /canceladdgame.'
          );
        }

        const postId = Number(match[1]);
        const url = `https://t.me/${CHANNEL}/${postId}`;
        const title = flow.title;

        const duplicate = await env.DB.prepare(
          'SELECT 1 FROM games WHERE lower(title)=lower(?) AND url=? LIMIT 1'
        ).bind(title, url).first();

        if (duplicate) {
          await env.DB.prepare(
            'DELETE FROM bot_game_add WHERE user_id=?'
          ).bind(String(m.from.id)).run();

          return send(
            env,
            chat,
            `Такая запись уже есть в каталоге:\n<b>${esc(title)}</b>\n${url}`
          );
        }

        await env.DB.prepare(
          'INSERT INTO games(title,url,post_id) VALUES(?,?,?)'
        ).bind(title, url, postId).run();

        await env.DB.prepare(
          'DELETE FROM bot_game_add WHERE user_id=?'
        ).bind(String(m.from.id)).run();

        return send(
          env,
          chat,
          `✅ Игра добавлена в каталог.\n\n<b>${esc(title)}</b>\n${url}`
        );
      }
    }
  }

  if (/^\/delgame(?:\s|$)/.test(txt)) {
    if (!await textAdmin(m.from.id, env)) {
      return send(env, chat, await getText(env, 'setup_forbidden'));
    }

    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    await env.DB.prepare(
      'DELETE FROM bot_game_add WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    const arg = txt.split(/\s+/)[1] || '';
    const match = arg.match(/^(?:https?:\/\/)?t\.me\/gpvkr\/(\d+)\/?$/i) || arg.match(/^(\d+)$/);

    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) {
      return send(env, chat, await getText(env, 'delgame_bad_id'));
    }

    const id = Number(match[1]);

    const rows = await env.DB.prepare(
      'SELECT title,url FROM games WHERE post_id=? ORDER BY title COLLATE NOCASE'
    ).bind(id).all();

    if (!rows.results.length) {
      return send(env, chat, await getText(env, 'delgame_not_found'));
    }

    const titles = rows.results.map(x => '• ' + esc(x.title)).join('\n');
    const url = `https://t.me/${CHANNEL}/${id}`;

    return send(
      env,
      chat,
      await getText(env, 'delgame_prompt', { id, titles, url }),
      [[
        btn(await getText(env, 'delgame_confirm_button'), `dg:y:${id}`),
        btn(await getText(env, 'delgame_cancel_button'), `dg:n:${id}`)
      ]]
    );
  }

  if (/^\/cooldown(?:\s|$)/.test(txt)) {
    if (!owner(m.from.id, env)) {
      return send(env, chat, await getText(env, 'setup_forbidden'));
    }

    const arg = txt.split(/\s+/)[1];

    if (arg === undefined) {
      const r = await env.DB.prepare(
        "SELECT value FROM bot_settings WHERE key='search_cooldown'"
      ).first();

      return send(env, chat, await getText(env, 'cooldown_show', {
        seconds: r?.value ?? 10
      }));
    }

    if (!/^\d+$/.test(arg) || Number(arg) > 3600) {
      return send(env, chat, await getText(env, 'cooldown_bad'));
    }

    await env.DB.prepare(
      "INSERT INTO bot_settings(key,value) VALUES('search_cooldown',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).bind(arg).run();

    return send(env, chat, await getText(env, 'cooldown_set', { seconds: arg }));
  }

  if (txt === '/setupcommands') {
    if (!await textAdmin(m.from.id, env)) {
      return send(env, chat, await getText(env, 'setup_forbidden'));
    }

    try {
      const result = await syncCommands(env, m.from.id);

      let message = await getText(
        env,
        result.changed ? 'setup_done' :
          result.errors.length ? 'setup_failed' : 'setup_unchanged'
      );

      if (result.errors.length) {
        message += '\n\n' + await getText(env, 'setup_partial', {
          changed: result.changed,
          failed: result.errors.length
        });

        message += '\n' + result.errors.map(x => '• ' + esc(x)).join('\n');
      }

      return send(env, chat, message);
    } catch (e) {
      console.error('setupcommands', e);

      return send(
        env,
        chat,
        await getText(env, 'setup_failed') + '\n' +
          esc(String(e?.message || e).slice(0, 180))
      );
    }
  }

  if (txt === '/help' || txt === '/commands') {
    return send(env, chat, await helpText(env, m.from.id));
  }

  if (/^\/textstatus(?:@\w+)?$/.test(txt)) {
    if (!owner(m.from.id, env)) {
      return send(env, chat, await getText(env, 'admin_forbidden'));
    }

    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    const rows = await env.DB.prepare(
      'SELECT key,value FROM bot_texts ORDER BY key'
    ).all();

    const changed = rows.results.filter(r => TEXTS[r.key]);

    if (!changed.length) {
      return send(
        env,
        chat,
        '✅ Изменённых текстов нет. Все ответы используют исходные значения.\n\nДля проверки после изменений снова отправь /textstatus.'
      );
    }

    let out = `<b>Изменённые тексты: ${changed.length}</b>\nСбросить отдельный пункт можно через /texts → «↩️ Сбросить».\n\n`;

    for (const r of changed) {
      const item = TEXTS[r.key];
      const preview = String(r.value).replace(/\s+/g, ' ').slice(0, 110);

      out += `• <b>${esc(item.label)}</b> <code>${esc(r.key)}</code>\n  ${esc(preview)}${String(r.value).length > 110 ? '…' : ''}\n\n`;
    }

    if (out.length > 3800) {
      out = out.slice(0, 3750) + '\n… Список длинный; сбрасывай отдельные пункты через /texts.';
    }

    return send(env, chat, out);
  }

  if (/^\/resettexts(?:@\w+)?$/.test(txt)) {
    if (!owner(m.from.id, env)) {
      return send(env, chat, await getText(env, 'admin_forbidden'));
    }

    await env.DB.prepare(
      'DELETE FROM bot_text_edit WHERE user_id=?'
    ).bind(String(m.from.id)).run();

    const r = await env.DB.prepare(
      'SELECT count(*) n FROM bot_texts'
    ).first();

    return send(
      env,
      chat,
      `⚠️ Сбросить все пользовательские изменения текстов? Сейчас изменённых пунктов в базе: ${Number(r?.n || 0)}. Это затронет ответы бота, уведомления администраторам и подписи кнопок, но не каталог игр.\n\nДля подтверждения нажми кнопку ниже.`,
      [[
        btn('↩️ Да, сбросить все тексты', 'rt:y'),
        btn('✖️ Отмена', 'rt:n')
      ]]
    );
  }

  if (txt === '/texts') {
    if (!owner(m.from.id, env)) {
      return send(env, chat, await getText(env, 'admin_forbidden'));
    }

    return showTextSettings(env, chat);
  }

  if (txt === '/whoami') {
    return send(env, chat, await getText(env, 'whoami', { id: m.from.id }));
  }

  if (m.document && txt === '/import' && await textAdmin(m.from.id, env)) {
    return importCsv(env, m);
  }

  if (txt === '/start' || txt === '/menu') {
    return send(env, chat, await getText(env, 'welcome'), await getMenu(env));
  }

  if (txt === '/count') {
    const r = await env.DB.prepare('SELECT count(*) n FROM games').first();
    return send(env, chat, await getText(env, 'count', { count: r.n }));
  }

  if (txt.sta