import { render } from '@testing-library/react';
import { BranchLines } from '../BranchLines';
import {
  buildTree,
  computeAngles,
  getLeaves,
  resetMatchIdCounter,
} from '../tree';

beforeEach(() => {
  resetMatchIdCounter();
});

const buildTestTree = () => {
  const tree = buildTree(['A', 'B']);
  const leaves = getLeaves(tree);
  leaves.forEach((l, i) => {
    l.angle = -90 + i * 180;
    l.angleIndex = i;
  });
  computeAngles(tree);
  return tree;
};

describe('BranchLines', () => {
  it('renders path elements for each match branch', () => {
    const root = buildTestTree();
    const { container } = render(
      <svg>
        <BranchLines root={root} winners={{}} ringStep={15} />
      </svg>
    );
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('highlights winning branch when winner matches', () => {
    const root = buildTestTree();
    const { container } = render(
      <svg>
        <BranchLines root={root} winners={{ m0: 'A' }} ringStep={15} />
      </svg>
    );
    const paths = container.querySelectorAll('path');
    const lit = Array.from(paths).filter((p) =>
      p.getAttribute('class')?.includes('stroke-primary')
    );
    expect(lit.length).toBeGreaterThan(0);
  });

  it('renders unlit paths when no winners', () => {
    const root = buildTestTree();
    const { container } = render(
      <svg>
        <BranchLines root={root} winners={{}} ringStep={15} />
      </svg>
    );
    const paths = container.querySelectorAll('path');
    const unlit = Array.from(paths).filter((p) =>
      p.getAttribute('class')?.includes('stroke-base-content/20')
    );
    expect(unlit.length).toBeGreaterThan(0);
  });
});
