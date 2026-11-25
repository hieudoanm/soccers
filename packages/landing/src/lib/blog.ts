import fs from 'node:fs';
import path from 'node:path';

export type Post = {
  slug: string;
  title: string;
  description?: string;
  author?: string;
  date?: string;
  order?: number;
  tags: string[];
  content: string;
};

export type SearchResult = {
  kind: 'doc' | 'post';
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  href: string;
  score: number;
};

const postsDirectory = path.join(process.cwd(), 'md', 'posts');
const postFilePattern = /^[a-z0-9-]+\.md$/i;
const blockScalarPattern = /^([^:]+):\s*([|>])[+-]?\d*\s*(?:#.*)?$/;

const leadingWhitespace = (line: string): number =>
  line.length - line.trimStart().length;

const normalizeBlockLines = (lines: string[]): string[] => {
  const contentLines = lines.filter((line) => line.trim() !== '');
  if (contentLines.length === 0) return [];
  const indent = Math.min(...contentLines.map(leadingWhitespace));
  return lines.map((line) =>
    line.trim() === ''
      ? ''
      : line.slice(Math.min(indent, leadingWhitespace(line)))
  );
};

const foldBlockLines = (lines: string[]): string => {
  let result = '';
  for (const [index, line] of lines.entries()) {
    if (index === 0) {
      result += line;
      continue;
    }
    const previous = lines[index - 1];
    if (
      line !== '' &&
      previous !== '' &&
      !line.startsWith(' ') &&
      !previous.startsWith(' ')
    ) {
      result += ' ';
    } else if (line === '' || previous !== '') {
      result += '\n';
    }
    result += line;
  }
  return result;
};

const parseBlockScalar = (lines: string[], style: '|' | '>'): string => {
  const normalized = normalizeBlockLines(lines);
  return style === '|' ? normalized.join('\n') : foldBlockLines(normalized);
};

const parseFrontmatter = (
  raw: string
): {
  data: Record<string, string>;
  body: string;
} => {
  if (!raw.startsWith('---')) {
    return { data: {}, body: raw };
  }
  const parts = raw.split('---');
  if (parts.length < 3) {
    return { data: {}, body: raw };
  }
  const frontmatter = parts[1];
  const body = parts.slice(2).join('---').replace(/^\n+/, '');
  const data: Record<string, string> = {};
  const lines = frontmatter.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const blockScalar = trimmed.match(blockScalarPattern);
    if (blockScalar) {
      const blockLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (candidate.trim() !== '' && !/^\s/.test(candidate)) break;
        blockLines.push(candidate);
        cursor++;
      }
      index = cursor - 1;
      const value = parseBlockScalar(
        blockLines,
        blockScalar[2] as '|' | '>'
      ).trim();
      data[blockScalar[1].trim()] = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    data[key] = value;
  }
  return { data, body };
};

const parseTags = (value: string | undefined): string[] => {
  if (!value) return [];
  const trimmed = value.trim();
  const list =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1).split(',')
      : trimmed.split(',');
  return Array.from(
    new Set(
      list
        .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .map((tag) => tag.toLowerCase())
    )
  );
};

const readPost = (filePath: string): Post => {
  const fileName = path.basename(filePath);
  const slug = fileName.replace(/\.md$/i, '');
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title =
    data.title?.trim() ||
    heading ||
    slug
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const order = data.order !== undefined ? Number(data.order) : undefined;

  return {
    slug,
    title,
    description: data.description,
    author: data.author,
    date: data.date,
    order: Number.isNaN(order as number) ? undefined : order,
    tags: parseTags(data.tags),
    content: body,
  };
};

const getPostFiles = (dir: string): string[] => {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getPostFiles(fullPath));
    } else if (entry.isFile() && postFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

export const getPosts = (): Post[] => {
  if (!fs.existsSync(postsDirectory)) return [];
  return getPostFiles(postsDirectory)
    .map(readPost)
    .sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined) {
        return left.order - right.order;
      }
      if (left.order !== undefined) return -1;
      if (right.order !== undefined) return 1;
      if (left.date && right.date) return left.date.localeCompare(right.date);
      return left.title.localeCompare(right.title, undefined, {
        numeric: true,
      });
    });
};

export const getPost = (slug: string): Post | undefined => {
  if (!/^[a-z0-9-]+$/.test(slug)) return undefined;
  const fileName = `${slug}.md`;
  const files = getPostFiles(postsDirectory);
  const found = files.find((file) => path.basename(file) === fileName);
  if (!found) return undefined;
  return readPost(found);
};
