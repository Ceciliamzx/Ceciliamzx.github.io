/**
 * 一次性导入脚本：将 Obsidian wiki 批量导入到 London Uncovered 知识库
 * 用法：node tools/import-obsidian.js
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
    // 处理数组（tags 等）
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

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function postWiki(item) {
  const res = await fetch(`${BASE_URL}/api/wiki`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const files = [];

  for (const sub of SUBDIRS) {
    const dir = path.join(OBSIDIAN_WIKI, sub);
    if (!fs.existsSync(dir)) { console.warn(`⚠ 目录不存在，跳过: ${dir}`); continue; }

    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      files.push(path.join(dir, f));
    }
  }

  console.log(`\n找到 ${files.length} 个 wiki 文件，开始导入...\n`);

  let ok = 0, fail = 0;

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
      await postWiki(item);
      console.log(`  ✓ ${title}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${title} — ${err.message}`);
      fail++;
    }

    // 避免频率限制
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n完成：${ok} 成功，${fail} 失败`);
}

main().catch(err => { console.error(err); process.exit(1); });
