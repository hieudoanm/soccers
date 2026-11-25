import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:fs', () => {
  const fs = {
    existsSync: fsMock.existsSync,
    readdirSync: fsMock.readdirSync,
    readFileSync: fsMock.readFileSync,
  };
  return { ...fs, default: fs };
});

import { getPost, getPosts } from '@/lib/blog';

const markdownFile = {
  name: 'block-scalars.md',
  isDirectory: () => false,
  isFile: () => true,
};

const fileEntry = (name: string) => ({
  name,
  isDirectory: () => false,
  isFile: () => true,
});

const readMarkdown = (frontmatter: string) => {
  fsMock.readdirSync.mockReturnValue([markdownFile]);
  fsMock.readFileSync.mockReturnValue(`---\n${frontmatter}\n---\n# Body\n`);
};

describe('frontmatter block scalars', () => {
  it('preserves newlines for literal blocks', () => {
    readMarkdown(`title: 'Block scalars'
description: |
  'First line
  second line'
author: 'hieudoan'`);

    const post = getPost('block-scalars');

    expect(post?.description).toBe('First line\nsecond line');
    expect(post?.author).toBe('hieudoan');
  });

  it('folds newlines for folded blocks', () => {
    readMarkdown(`title: 'Block scalars'
description: >
  'First line
  second line'`);

    expect(getPost('block-scalars')?.description).toBe(
      'First line second line'
    );
  });

  it('accepts chomping indicators', () => {
    readMarkdown(`title: 'Block scalars'
description: |-
  First line
  second line`);

    expect(getPost('block-scalars')?.description).toBe(
      'First line\nsecond line'
    );
  });
});

describe('post fallbacks', () => {
  it('returns an empty list when the posts directory is missing', () => {
    fsMock.existsSync.mockReturnValueOnce(false);
    expect(getPosts()).toEqual([]);
  });

  it('falls back to a slug title without frontmatter', () => {
    fsMock.readdirSync.mockReturnValue([fileEntry('plain-post.md')]);
    fsMock.readFileSync.mockReturnValue('Just text.');

    expect(getPost('plain-post')?.title).toBe('Plain Post');
  });

  it('falls back to the first markdown heading', () => {
    fsMock.readdirSync.mockReturnValue([fileEntry('heading-post.md')]);
    fsMock.readFileSync.mockReturnValue('# Heading Title\n\nBody.');

    expect(getPost('heading-post')?.title).toBe('Heading Title');
  });

  it('treats frontmatter without a closing delimiter as body', () => {
    fsMock.readdirSync.mockReturnValue([fileEntry('broken-post.md')]);
    fsMock.readFileSync.mockReturnValue('---\ntitle: Broken');

    expect(getPost('broken-post')?.title).toBe('Broken Post');
  });
});

describe('getPosts sorting', () => {
  it('sorts by order, then date, then title', () => {
    const names = ['b.md', 'a.md', 'c.md', 'd.md', 'e.md'];
    fsMock.readdirSync.mockReturnValue(names.map(fileEntry));
    const contents: Record<string, string> = {
      'b.md': "---\norder: 2\ntitle: 'Beta'\n---\n# Beta",
      'a.md': "---\ndate: '2020-01-01'\ntitle: 'Alpha'\n---\n# Alpha",
      'c.md': "---\norder: 1\ntitle: 'Gamma'\n---\n# Gamma",
      'd.md': "---\ndate: '2021-01-01'\ntitle: 'Delta'\n---\n# Delta",
      'e.md': "---\ntitle: 'Epsilon'\n---\n# Epsilon",
    };
    fsMock.readFileSync.mockImplementation(
      (filePath) => contents[path.basename(String(filePath))]
    );

    const posts = getPosts();

    expect(posts.map((post) => post.slug)).toEqual(['c', 'b', 'a', 'd', 'e']);
  });
});
