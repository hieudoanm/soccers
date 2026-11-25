import type { Mock } from 'vitest';
import html2canvas from 'html2canvas-pro';
import { download, downloadLineupPng } from '@/lib/canvas';

vi.mock('html2canvas-pro', () => ({
  default: vi
    .fn()
    .mockResolvedValue({ toDataURL: () => 'data:image/png;base64,x' }),
}));

const mockHtml2canvas = vi.mocked(html2canvas) as Mock;

describe('canvas', () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    click.mockRestore();
  });

  describe('downloadLineupPng', () => {
    it('captures the ref element and downloads a PNG', async () => {
      const ref = { current: document.createElement('div') };
      await downloadLineupPng(ref, 'my-squad');
      expect(mockHtml2canvas).toHaveBeenCalledWith(
        ref.current,
        expect.objectContaining({ scale: 2, backgroundColor: '#14532d' })
      );
      expect(click).toHaveBeenCalled();
    });

    it('no-ops when the ref has no element', async () => {
      await downloadLineupPng({ current: null }, 'squad');
      expect(mockHtml2canvas).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('no-ops when the ref has no element', async () => {
      await download({ ref: { current: null }, output: 'test' });
      expect(mockHtml2canvas).not.toHaveBeenCalled();
    });

    it('captures and downloads a PNG with default options', async () => {
      const div = document.createElement('div');
      const ref = { current: div };
      await download({ ref, output: 'test' });
      expect(mockHtml2canvas).toHaveBeenCalledWith(
        div,
        expect.objectContaining({ scale: 1, backgroundColor: '#ffffff' })
      );
      expect(click).toHaveBeenCalled();
    });

    it('passes custom options to html2canvas', async () => {
      const div = document.createElement('div');
      const ref = { current: div };
      await download({
        ref,
        output: 'custom',
        backgroundColor: '#000000',
        scale: 2,
      });
      expect(mockHtml2canvas).toHaveBeenCalledWith(
        div,
        expect.objectContaining({ scale: 2, backgroundColor: '#000000' })
      );
    });

    it('fixes gradient classes before capture and restores after', async () => {
      const div = document.createElement('div');
      div.innerHTML =
        '<span class="bg-clip-text text-transparent bg-gradient-to-r from-red-500 to-blue-500">Text</span>';
      const span = div.querySelector('span')!;
      const ref = { current: div };
      await download({ ref, output: 'gradient-test' });
      expect(click).toHaveBeenCalled();
    });
  });
});
