import { btn, link, send, edit } from './shared.js';

export const GENRES = [
  { name: 'Новелла', slug: 'visual-novel', tags: ['новелла'] },
  { name: 'Отоме', slug: 'otome', tags: ['отоме'] },
  { name: 'RPG', slug: 'rpg', tags: ['рпг'] },
  { name: 'Экшн', slug: 'action', tags: ['экшн', 'экшен'] },
  { name: 'Шутер', slug: 'shooter', tags: ['шутер'] },
  { name: 'Хоррор', slug: 'horror', tags: ['хоррор'] },
  { name: 'Приключения', slug: 'adventure', tags: ['приключения'] },
  { name: 'Инди', slug: 'indie', tags: ['инди'] },
  { name: 'Метроидвания', slug: 'metroidvania', tags: ['метроидвания'] },
  { name: 'Настольная', slug: 'board-game', tags: ['настольная'] },
  { name: 'Песочница', slug: 'sandbox', tags: ['песочница'] },
  { name: 'Симулятор', slug: 'simulator', tags: ['симулятор'] },
  { name: 'Головоломка', slug: 'puzzle', tags: ['головоломка'] },
  { name: 'Рогалик', slug: 'roguelike', tags: ['рогалик'] },
  { name: 'Мультиплеер', slug: 'multiplayer', tags: ['мультиплеер'] },
  { name: 'Гонки', slug: 'racing', tags: ['гонки'] },
  { name: 'Аркада', slug: 'arcade', tags: ['аркада'] },
  { name: 'Стратегия', slug: 'strategy', tags: ['стратегия'] },
  { name: 'Битемап', slug: 'beat-em-up', tags: ['битемап'] },
  { name: 'Файтинг', slug: 'fighting', tags: ['файтинг'] },
  { name: 'Платформер', slug: 'platformer', tags: ['платформер'] },
  { name: 'Выживач', slug: 'survival', tags: ['выживач'] }
];

export const TECHNICAL_TAGS = [
  'взлом', 'мод', 'кэш', 'изпредложки', 'эмулятор', 'порт'
];

const SKIP_TAGS = new Set(['оффтоп', 'новости', 'хентай']);

export function postTags(post) {
  const text = `${post?.text || ''}\n${post?.caption || ''}`;
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)]
    .map(match => match[1].toLowerCase().replaceAll('ё', 'е'));
}

export function shouldSkipPost(post) {
  return postTags(post).some(tag => SKIP_TAGS.has(tag));
}

export function genreSlugsFromPost(post) {
  const tags = new Set(postTags(post));
  return GENRES
    .filter(genre => genre.tags.some(tag => tags.has(tag)))
    .map(genre => genre.slug);
}

export async function initGenres(env) {
  for (const genre of GENRES) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO genres(name, slug) VALUES(?, ?)'
    ).bind(genre.name, genre.slug).run();
  }
}

export async function attachGenresToGame(env, gameId, slugs) {
  if (!gameId || !slugs?.length) return;

  for (const slug of slugs) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO game_genres(game_id, genre_id)
      SELECT ?, id FROM genres WHERE slug = ?
    `).bind(gameId, slug).run();
  }
}

export async function showGenres(env, chat, msg = null) {
  const result = await env.DB.prepare(`
    SELECT g.id, g.name, COUNT(DISTINCT gg.game_id) AS total
    FROM genres g
    LEFT JOIN game_genres gg ON gg.genre_id = g.id
    GROUP BY g.id
    ORDER BY g.name COLLATE NOCASE
  `).all();

  const rows = [];
  for (let i = 0; i < result.results.length; i += 2) {
    rows.push(result.results.slice(i, i + 2).map(g =>
      btn(`${g.name} (${g.total})`, `genre:${g.id}:0`)
    ));
  }

  rows.push([btn('Главное меню', 'home')]);
  const text = 'Выбери жанр игры:';

  return msg
    ? edit(env, chat, msg, text, rows)
    : send(env, chat, text, rows);
}

export async function showGenreGames(env, chat, msg, genreId, page = 0) {
  genreId = Number(genreId);
  page = Math.max(0, Number(page) || 0);

  if (!Number.isSafeInteger(genreId) || genreId < 1) return;

  const genre = await env.DB.prepare(
    'SELECT id, name FROM genres WHERE id = ?'
  ).bind(genreId).first();

  if (!genre) return;

  const count = await env.DB.prepare(`
    SELECT COUNT(DISTINCT g.id) AS total
    FROM games g
    JOIN game_genres gg ON gg.game_id = g.id
    WHERE gg.genre_id = ?
  `).bind(genreId).first();

  const total = Number(count?.total || 0);
  const pages = Math.max(1, Math.ceil(total / 8));
  page = Math.min(page, pages - 1);

  const result = await env.DB.prepare(`
    SELECT g.title, g.url
    FROM games g
    JOIN game_genres gg ON gg.game_id = g.id
    WHERE gg.genre_id = ?
    ORDER BY g.title COLLATE NOCASE
    LIMIT 8 OFFSET ?
  `).bind(genreId, page * 8).all();

  const rows = result.results.map(g => [
    link(g.title.slice(0, 60), g.url)
  ]);

  const nav = [];
  if (page > 0) nav.push(btn('Назад', `genre:${genreId}:${page - 1}`));
  nav.push(btn(`${page + 1}/${pages}`, 'noop'));
  if (page + 1 < pages) nav.push(btn('Вперёд', `genre:${genreId}:${page + 1}`));
  rows.push(nav);
  rows.push([
    btn('Все жанры', 'genres'),
    btn('Главное меню', 'home')
  ]);

  return edit(
    env, chat, msg,
    `Жанр: ${genre.name}\nИгр: ${total}`,
    rows
  );
}