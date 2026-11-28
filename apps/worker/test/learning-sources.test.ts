import { retrieveLearningSources } from '../src/learning/sources/retrieval';
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { isPublicAddress, downloadPublicSource } from '../src/learning/sources/download';
import { extractOffice, extractWebPage, textPassages } from '../src/learning/sources/documents';
import { anchoredVisionPin } from '../src/learning/vision';
describe('bounded private source ingestion', () => {
  it('blocks local, private, mapped IPv4, link-local and multicast addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.20.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '224.0.0.1',
    ])
      expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('rejects credentialed URLs and unsupported schemes before connecting', async () => {
    for (const url of [
      'file:///etc/passwd',
      'https://name:password@example.org',
      'http://example.org:8080',
    ])
      await expect(downloadPublicSource(url)).rejects.toThrow('public HTTP');
  });
  it('extracts page text without scripts, navigation or arbitrary code', () => {
    const result = extractWebPage(
      Buffer.from(
        '<html><body><nav>Ignore navigation</nav><article>The heart has four chambers and pumps blood.</article><script>throw new Error("executed")</script></body></html>',
      ),
    );
    expect(result).toEqual([
      { id: 'p1', page: 1, text: 'The heart has four chambers and pumps blood.' },
    ]);
  });
  it('extracts DOCX with decoded text and stable passage references', () => {
    const bytes = zipSync({
      'word/document.xml': strToU8(
        '<w:document xmlns:w="word"><w:p><w:r><w:t>Pressure &amp; flow are related in a circuit.</w:t></w:r></w:p></w:document>',
      ),
    });
    const result = extractOffice(
      bytes,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result[0]).toEqual({
      id: 'page1_1',
      page: 1,
      text: 'Pressure & flow are related in a circuit.',
    });
  });
  it('orders PowerPoint slides numerically and preserves slide references', () => {
    const slide = (text: string) =>
      strToU8(
        `<p:sld xmlns:p="slide" xmlns:a="drawing"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`,
      );
    const bytes = zipSync({
      'ppt/slides/slide10.xml': slide('Third source slide about anatomy.'),
      'ppt/slides/slide2.xml': slide('Second source slide about anatomy.'),
      'ppt/slides/slide1.xml': slide('First source slide about anatomy.'),
    });
    const result = extractOffice(
      bytes,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(result.map((p) => p.text.split(' ')[0])).toEqual(['First', 'Second', 'Third']);
    expect(result.map((p) => p.page)).toEqual([1, 2, 10]);
  });
  it('rejects oversized and entity-declaration documents', () => {
    expect(() => textPassages('x'.repeat(100001))).toThrow('100,000');
    const bytes = zipSync({
      'word/document.xml': strToU8(
        '<!DOCTYPE a [<!ENTITY leak SYSTEM "file:///etc/passwd">]><w:t>Untrusted document text.</w:t>',
      ),
    });
    expect(() => extractOffice(bytes, 'wordprocessingml')).toThrow('entity declarations');
  });
  it('snaps visual proposals only to measured nearby surfaces', () => {
    const views = [
      {
        name: 'Front',
        image: '',
        anchors: [
          {
            x: 0.5,
            y: 0.5,
            meshKey: 'mesh-2',
            position: [0.1, 0.2, 0.3] as [number, number, number],
          },
        ],
      },
    ];
    expect(anchoredVisionPin(views, 0, [0.51, 0.51])).toEqual({
      meshKey: 'mesh-2',
      position: [0.1, 0.2, 0.3],
    });
    expect(anchoredVisionPin(views, 0, [0.9, 0.9])).toBeNull();
    expect(anchoredVisionPin(views, 3, [0.5, 0.5])).toBeNull();
  });
  it('retrieves relevant later pages without dropping attached documents or changing citation IDs', () => {
    const result = retrieveLearningSources(
      [
        {
          id: 'one',
          title: 'Body systems',
          passages: [
            { id: 'page1_1', page: 1, text: 'An introduction to biology.' },
            {
              id: 'page40_1',
              page: 40,
              text: 'The heart pumps blood through the circulatory system.',
            },
          ],
        },
        {
          id: 'two',
          title: 'Exercise notes',
          passages: [{ id: 'p1', page: 1, text: 'Discuss how circulation supports exercise.' }],
        },
      ],
      'Create a lesson about the heart and circulation',
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.passages[0]!.id).toBe('page40_1');
    expect(result[0]!.passages[0]!.page).toBe(40);
    expect(
      result.flatMap((s) => s.passages).reduce((n, p) => n + p.text.length, 0),
    ).toBeLessThanOrEqual(36000);
  });
});
