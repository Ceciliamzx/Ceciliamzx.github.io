/**
 * Obsidian → London Uncovered Wiki 同步脚本
 * 用法：node tools/import-obsidian.js
 *
 * 同名标题（title_en）已存在 → PUT 更新
 * 不存在 → POST 新建
 * 不会产生重复条目
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://london-uncovered-73rr.vercel.app';
const OBSIDIAN_WIKI = 'D:/personal/Obsidian Vault/wiki';
const SUBDIRS = ['topics', 'concepts', 'entities'];

// ── 解析 YAML frontmatter ─────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    meta[key] = val.trim().replace(/^["']|["']$/g, '');
  }

  // 单独解析 tags（多行列表格式）
  const tagsMatch = match[1].match(/^tags:\n((?:  - .+\n?)+)/m);
  if (tagsMatch) {
    meta.tags = tagsMatch[1]
      .split('\n')
      .map(l => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }

  return { meta, body: match[2].trim() };
}

// ── 清理 Obsidian 语法 ────────────────────────────────────────────────────────

function cleanBody(text) {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')  // [[link|显示文字]] → 显示文字
    .replace(/\[\[([^\]]+)\]\]/g, '$1')               // [[link]] → link
    .trim();
}

// ── 从文件名或 title 推断标题 ─────────────────────────────────────────────────

function toTitle(filename, meta) {
  if (meta.title) return meta.title.replace(/^["']|["']$/g, '');
  return filename
    .replace(/\.md$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── API 调用 ──────────────────────────────────────────────────────────────────

async function fetchExisting() {
  const res = await fetch(`${BASE_URL}/api/wiki`);
  if (!res.ok) throw new Error(`获取现有 wiki 失败: HTTP ${res.status}`);
  return res.json();
}

async function createWiki(item) {
  const res = await fetch(`${BASE_URL}/api/wiki`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function updateWiki(id, item) {
  const res = await fetch(`${BASE_URL}/api/wiki/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. 读取所有 Obsidian 文件
  const files = [];
  for (const sub of SUBDIRS) {
    const dir = path.join(OBSIDIAN_WIKI, sub);
    if (!fs.existsSync(dir)) { console.warn(`⚠ 目录不存在，跳过: ${dir}`); continue; }
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.md')) files.push(path.join(dir, f));
    }
  }
  console.log(`\n找到 ${files.length} 个 wiki 文件`);

  // 2. 拉取线上现有条目，建立 title_en → id 的映射
  console.log('正在获取线上现有条目...');
  const existing = await fetchExisting();
  const titleMap = {};
  existing.forEach(w => { titleMap[w.title_en] = w.id; });
  console.log(`线上现有 ${existing.length} 篇，开始同步...\n`);

  let created = 0, updated = 0, fail = 0;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(raw);
    const cleanedBody = cleanBody(body);
    const title = toTitle(filename, meta);
    const tags = Array.isArray(meta.tags) ? meta.tags : [];

    const item = {
      title_zh: title,
      title_en: title,
      body_zh: cleanedBody,
      body_en: cleanedBody,
      tags
    };

    try {
      if (titleMap[title]) {
        // 已存在 → 更新
        await updateWiki(titleMap[title], item);
        console.log(`  ↺ 更新  ${title}`);
        updated++;
      } else {
        // 不存在 → 新建
        await createWiki(item);
        console.log(`  ✓ 新增  ${title}`);
        created++;
      }
    } catch (err) {
      console.error(`  ✗ 失败  ${title} — ${err.message}`);
      fail++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n完成：新增 ${created} 篇，更新 ${updated} 篇，失败 ${fail} 篇`);
}

main().catch(err => { console.error(err); process.exit(1); });
