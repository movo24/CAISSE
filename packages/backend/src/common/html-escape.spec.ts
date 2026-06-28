import { escapeHtml } from './html-escape';

describe('POS-132 escapeHtml', () => {
  it('escapes the dangerous set', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#x27;',
    );
  });
  it('neutralizes an injected img onerror payload', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });
  it('null/undefined/empty → empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });
  it('plain text is unchanged', () => {
    expect(escapeHtml('Café Wesley')).toBe('Café Wesley');
  });
  it('escapes & first (no double-escaping artifacts)', () => {
    expect(escapeHtml('A & B < C')).toBe('A &amp; B &lt; C');
  });
});
